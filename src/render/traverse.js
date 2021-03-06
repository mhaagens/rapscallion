const { getChildContext, getContext } = require("./context");
const { syncSetState } = require("./state");
const { htmlStringEscape } = require("./util");
const renderAttrs = require("./attrs");

const { REACT_ID } = require("../symbols");


function renderChildrenArray (seq, children, context) {
  for (let idx = 0; idx < children.length; idx++) {
    const child = children[idx];
    if (child instanceof Array) {
      renderChildrenArray(seq, child, context);
    } else {
      traverse(seq, child, context);
    }
  }
}

function renderChildren (seq, children, context) {
  if (!children) { return; }

  if (children instanceof Array) {
    renderChildrenArray(seq, children, context);
  } else {
    traverse(seq, children, context);
  }
}

/**
 * Evaluates a plain-jane VDOM node (like a <div>).
 *
 * @param      {Sequence}  seq      Sequence that receives HTML segments.
 * @param      {VDOM}      node     VDOM node to be rendered.
 * @param      {Object}    context  Context for the node's children.
 *
 * @return     {undefined}          No return value.
 */
function renderNode (seq, node, context) {
  seq.emit(() => `<${node.type}`);
  seq.emit(() => renderAttrs(node.props, seq));
  seq.emit(() => REACT_ID);
  seq.emit(() => ">");
  if (node.props.dangerouslySetInnerHTML) {
    seq.emit(() => node.props.dangerouslySetInnerHTML.__html || "");
  } else {
    seq.delegate(() => renderChildren(seq, node.props.children, context));
  }
  seq.emit(() => `</${node.type}>`);
}

/**
 * Prior to being rendered, React components are represented in the same
 * way as true HTML DOM elements.  This function evaluates the component
 * and traverses through its rendered elements.
 *
 * @param      {Sequence}  seq      Sequence that receives HTML segments.
 * @param      {VDOM}      node     VOM node (of a component).
 * @param      {Object}    context  React context.
 *
 * @return     {undefined}          No return value.
 */
function evalComponent (seq, node, context) {
  const componentContext = getContext(node.type, context);

  if (!(node.type.prototype && node.type.prototype.isReactComponent)) {
    const instance = node.type(node.props, componentContext);
    const childContext = getChildContext(node.type, instance, context);
    traverse(seq, instance, childContext);
    return;
  }

  // eslint-disable-next-line new-cap
  const instance = new node.type(node.props, componentContext);
  
  let res = null;
  let promise = null;

  if (typeof instance.componentWillMount === "function") {
    instance.setState = syncSetState;
    res = instance.componentWillMount();
  }

  if (res && res.then) {
    promise = res
  }

  let done = false;

  if(promise){
    promise.then(() => {done = true;});
  } else {
    done = true;
  }

  require('deasync').loopWhile(function(){return !done;});

  if (done) {
    const childContext = getChildContext(node.type, instance, context);
    traverse(seq, instance.render(), childContext);
  }

}

/**
 * This function will recursively traverse the VDOM tree, emitting HTML segments
 * to the provided sequence.
 *
 * @param      {Sequence}  seq      Sequence that receives HTML segments.
 * @param      {VDOM}      node     Root VDOM node.
 * @param      {Object}    context  React context.
 *
 * @return     {undefined}          No return value.
 */
function traverse (seq, node, context) {
  // A Component's render function might return `null`.
  if (!node) { return; }

  switch (typeof node) {
  case "string": {
    // Text node.
    seq.emit(() => htmlStringEscape(node));
    return;
  }
  case "number": {
    seq.emit(() => node.toString());
    return;
  }
  case "object": {
    if (typeof node.type === "string") {
      // Plain-jane DOM element, not a React component.
      seq.delegateCached(node, (_seq, _node) => renderNode(_seq, _node, context));
      return;
    } else if (node.$$typeof) {
      // React component.
      seq.delegateCached(node, (_seq, _node) => evalComponent(_seq, _node, context));
      return;
    }
  }
  }

  throw new TypeError(`Unknown node of type: ${node.type}`);
}


module.exports = traverse;
