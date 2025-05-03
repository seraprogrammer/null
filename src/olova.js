/**
 * Simplified Olova.js - A lightweight reactivity library
 * Version 1.0.0
 */

// Core internal functionality needed to support the public API
let currentEffect = null;
const effectStack = [];

// Internal function to create a signal (needed by other functions)
function createSignal(initialValue) {
  const subscribers = new Set();
  let value = initialValue;

  const signal = {
    value,
    subscribers,
  };

  const get = () => {
    if (currentEffect) {
      subscribers.add(currentEffect);
      currentEffect.dependencies.add(signal);
    }
    return value;
  };

  const set = (newValue) => {
    if (Object.is(value, newValue)) return;

    if (typeof newValue === "function") {
      newValue = newValue(value);
    }

    value = newValue;

    queueMicrotask(() => {
      const currentSubscribers = [...subscribers];
      for (const subscriber of currentSubscribers) {
        subscriber.execute();
      }
    });
  };

  return [get, set, signal];
}

// Internal function to create an effect (needed by other functions)
function createEffect(fn) {
  const effect = {
    execute() {
      for (const dep of effect.dependencies) {
        dep.subscribers.delete(effect);
      }
      effect.dependencies.clear();

      const prevEffect = currentEffect;
      currentEffect = effect;
      effectStack.push(effect);

      try {
        effect.value = fn();
      } finally {
        effectStack.pop();
        currentEffect =
          effectStack.length > 0 ? effectStack[effectStack.length - 1] : null;
      }

      return effect.value;
    },
    dependencies: new Set(),
    value: undefined,
  };

  effect.execute();
  return effect;
}

// Internal batching functionality needed by store
function batch(fn) {
  const prevBatchDepth = batchDepth;
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && batchedEffects.size > 0) {
      const effects = [...batchedEffects];
      batchedEffects.clear();
      for (const effect of effects) {
        effect.execute();
      }
    }
  }
}

let batchDepth = 0;
const batchedEffects = new Set();

// Internal store functionality needed by component system
function createStore(initialState) {
  const signals = new Map();

  function getSignal(path) {
    let signal = signals.get(path);
    if (!signal) {
      let value = path.split(".").reduce((obj, key) => obj[key], initialState);
      const [get, set] = createSignal(value);
      signal = { get, set };
      signals.set(path, signal);
    }
    return signal;
  }

  function setPathValue(target, path, value) {
    const parts = path.split(".");
    const last = parts.pop();
    const parent = parts.reduce((obj, key) => obj[key], target);
    parent[last] = value;
  }

  function createDeepProxy(target, basePath = "") {
    return new Proxy(target, {
      get(target, prop) {
        if (typeof prop === "symbol" || prop === "toJSON") {
          return target[prop];
        }

        const path = basePath ? `${basePath}.${prop}` : prop;
        const value = target[prop];

        if (value && typeof value === "object" && !Array.isArray(value)) {
          return createDeepProxy(value, path);
        }

        const signal = getSignal(path);
        return signal.get();
      },

      set(target, prop, value) {
        const path = basePath ? `${basePath}.${prop}` : prop;

        if (value && typeof value === "object" && !Array.isArray(value)) {
          Object.entries(value).forEach(([key, val]) => {
            const fullPath = `${path}.${key}`;
            setPathValue(target, fullPath, val);
            const signal = getSignal(fullPath);
            signal.set(val);
          });
        } else {
          target[prop] = value;
          const signal = getSignal(path);
          signal.set(value);
        }

        return true;
      },
    });
  }

  const proxy = createDeepProxy(initialState);

  const setStore = (newState) => {
    if (typeof newState === "function") {
      newState = newState(proxy);
    }

    batch(() => {
      Object.entries(newState).forEach(([key, value]) => {
        proxy[key] = value;
      });
    });
  };

  return [proxy, setStore];
}

/**
 * Component creation system with fine-grained reactivity
 */
function createComponent(options) {
  return (props = {}) => {
    // Register subcomponents
    const registeredComponents = options.components || {};

    const [state, setState] = createStore(
      typeof options.setup === "function"
        ? options.setup(props)
        : options.data
        ? options.data()
        : {}
    );

    // Add props to state
    Object.entries(props).forEach(([key, value]) => {
      if (!(key in state)) {
        state[key] = value;
      }
    });

    // Process methods
    if (options.methods) {
      Object.entries(options.methods).forEach(([name, method]) => {
        state[name] = (...args) => method.apply(state, args);
      });
    }

    const element = document.createElement("div");

    // Initial render
    const template = document.createElement("template");
    template.innerHTML = options.template;
    const content = template.content.cloneNode(true);

    // Process custom components
    processComponents(content, registeredComponents, state);

    // Process text nodes for reactivity
    processTextNodes(content, state);

    // Process attributes for reactivity
    processAttributes(content, state);

    // Process event listeners
    processEventListeners(content, state);

    // Add content to element
    element.appendChild(content);

    // Setup watchers
    if (options.watch) {
      Object.entries(options.watch).forEach(([key, handler]) => {
        createEffect(() => {
          const value = key.split(".").reduce((obj, prop) => obj[prop], state);
          handler.call(state, value);
        });
      });
    }

    // Call mounted hook
    if (options.mounted) {
      queueMicrotask(() => options.mounted.call(state));
    }

    // Setup unmounted/beforeDestroy hook if needed
    if (options.unmounted || options.beforeDestroy) {
      const cleanupFn = options.unmounted || options.beforeDestroy;
      element._cleanup = () => cleanupFn.call(state);
    }

    return element;
  };
}

// Process custom components in the template
function processComponents(node, components, parentState) {
  const componentTags = Object.keys(components);

  if (componentTags.length === 0) return;

  const elementWalker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_ELEMENT,
    null,
    false
  );

  const componentElements = [];
  let currentElement;

  while ((currentElement = elementWalker.nextNode())) {
    if (componentTags.includes(currentElement.tagName.toLowerCase())) {
      componentElements.push(currentElement);
    }
  }

  for (const element of componentElements) {
    const tagName = element.tagName.toLowerCase();
    const componentFactory = components[tagName];

    if (!componentFactory) continue;

    // Collect props from attributes
    const props = {};
    Array.from(element.attributes).forEach((attr) => {
      let value = attr.value;

      // Handle dynamic props with {expression}
      if (value.match(/^{.+}$/)) {
        const expr = value.substring(1, value.length - 1).trim();
        try {
          value = evaluateExpression(expr, parentState);
        } catch (e) {
          console.error(`Error evaluating prop expression: ${expr}`, e);
        }
      }

      props[attr.name] = value;
    });

    // Create the component instance
    const componentInstance = componentFactory(props);

    // Replace the custom element with the component
    element.parentNode.replaceChild(componentInstance, element);
  }
}

function processTextNodes(node, state) {
  const textWalker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  const textNodes = [];
  let currentNode;
  while ((currentNode = textWalker.nextNode())) {
    textNodes.push(currentNode);
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue;
    const matches = [...text.matchAll(/{([^}]+)}/g)];

    if (matches.length === 0) continue;

    // If the text node contains expressions, set up reactivity
    if (matches.length === 1 && matches[0][0] === text) {
      // The text node contains only one expression that makes up the entire content
      const expr = matches[0][1].trim();

      createEffect(() => {
        try {
          const value = evaluateExpression(expr, state);
          textNode.nodeValue = value !== undefined ? value : "";
        } catch (e) {
          console.error("Error in text expression:", expr, e);
          textNode.nodeValue = "";
        }
      });
    } else {
      // The text node contains multiple expressions or mixed content
      const originalText = text;

      createEffect(() => {
        let result = originalText;

        for (const match of matches) {
          const expr = match[1].trim();
          try {
            const value = evaluateExpression(expr, state);
            result = result.replace(match[0], value !== undefined ? value : "");
          } catch (e) {
            console.error("Error in text expression:", expr, e);
            result = result.replace(match[0], "");
          }
        }

        textNode.nodeValue = result;
      });
    }
  }
}

function processAttributes(node, state) {
  const elementWalker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_ELEMENT,
    null,
    false
  );

  const elements = [];
  let currentElement;
  while ((currentElement = elementWalker.nextNode())) {
    elements.push(currentElement);
  }

  for (const element of elements) {
    Array.from(element.attributes).forEach((attr) => {
      // Skip event handlers, they're processed separately
      if (attr.name.startsWith("@")) return;

      // Special handling for style attribute
      if (attr.name === "style") {
        const value = attr.value;
        const matches = [...value.matchAll(/{([^}]+)}/g)];

        if (matches.length > 0) {
          createEffect(() => {
            let result = value;

            for (const match of matches) {
              const expr = match[1].trim();
              try {
                const exprValue = evaluateExpression(expr, state);
                result = result.replace(
                  match[0],
                  exprValue !== undefined ? exprValue : ""
                );
              } catch (e) {
                console.error("Error in style expression:", expr, e);
                result = result.replace(match[0], "");
              }
            }

            element.style = result;
          });
        }
        return;
      }

      // Special handling for class attribute
      if (attr.name === "class") {
        const value = attr.value;
        const matches = [...value.matchAll(/{([^}]+)}/g)];

        if (matches.length > 0) {
          const staticClasses = value
            .replace(/{[^}]+}/g, "")
            .trim()
            .split(/\s+/)
            .filter(Boolean);

          createEffect(() => {
            // Start with static classes
            const finalClasses = [...staticClasses];

            // Add dynamic classes
            for (const match of matches) {
              const expr = match[1].trim();
              try {
                const exprValue = evaluateExpression(expr, state);
                if (exprValue) {
                  // Handle object syntax { class: condition }
                  if (typeof exprValue === "object") {
                    Object.entries(exprValue).forEach(
                      ([className, condition]) => {
                        if (condition) finalClasses.push(className);
                      }
                    );
                  } else {
                    // Handle string or other truthy values
                    finalClasses.push(String(exprValue));
                  }
                }
              } catch (e) {
                console.error("Error in class expression:", expr, e);
              }
            }

            element.className = finalClasses.join(" ");
          });
        }
        return;
      }

      const value = attr.value;
      const matches = [...value.matchAll(/{([^}]+)}/g)];

      if (matches.length === 0) return;

      // If attribute contains expressions, set up reactivity
      if (matches.length === 1 && matches[0][0] === value) {
        // The attribute contains only one expression that makes up the entire content
        const expr = matches[0][1].trim();

        createEffect(() => {
          try {
            const result = evaluateExpression(expr, state);
            element.setAttribute(attr.name, result !== undefined ? result : "");
          } catch (e) {
            console.error("Error in attribute expression:", expr, e);
            element.setAttribute(attr.name, "");
          }
        });
      } else {
        // The attribute contains multiple expressions or mixed content
        const originalValue = value;

        createEffect(() => {
          let result = originalValue;

          for (const match of matches) {
            const expr = match[1].trim();
            try {
              const value = evaluateExpression(expr, state);
              result = result.replace(
                match[0],
                value !== undefined ? value : ""
              );
            } catch (e) {
              console.error("Error in attribute expression:", expr, e);
              result = result.replace(match[0], "");
            }
          }

          element.setAttribute(attr.name, result);
        });
      }
    });
  }
}

function processEventListeners(node, state) {
  const elementWalker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_ELEMENT,
    null,
    false
  );

  const elements = [];
  let currentElement;
  while ((currentElement = elementWalker.nextNode())) {
    elements.push(currentElement);
  }

  for (const element of elements) {
    Array.from(element.attributes).forEach((attr) => {
      if (!attr.name.startsWith("@")) return;

      const eventName = attr.name.slice(1); // Remove the '@'
      const methodName = attr.value;

      element.removeAttribute(attr.name);

      element.addEventListener(eventName, (event) => {
        if (typeof state[methodName] === "function") {
          state[methodName](event);
        } else {
          console.error(`Method ${methodName} not found`);
        }
      });
    });
  }
}

function evaluateExpression(expr, context) {
  try {
    // Support for ternary operators
    if (expr.includes("?") && expr.includes(":")) {
      const [condition, rest] = expr.split("?").map((s) => s.trim());
      const [trueExpr, falseExpr] = rest.split(":").map((s) => s.trim());

      // Evaluate the condition
      const conditionResult = evaluateExpression(condition, context);

      // Return the appropriate expression result
      return conditionResult
        ? evaluateExpression(trueExpr, context)
        : evaluateExpression(falseExpr, context);
    }

    // Simple expressions (property access)
    if (expr.includes("(") || expr.includes(")")) {
      throw new Error("Complex expressions not supported");
    }

    return expr.split(".").reduce((obj, prop) => obj[prop], context);
  } catch (e) {
    console.error("Expression evaluation failed:", expr, e);
    return "";
  }
}

/**
 * Creates and mounts an application
 */
function createApp(options) {
  const component = createComponent(options);
  let app;

  return {
    mount(selector) {
      const container = document.querySelector(selector);
      if (!container) {
        console.error(`Element ${selector} not found`);
        return;
      }

      app = component({});
      container.innerHTML = "";
      container.appendChild(app);

      return this;
    },
    unmount() {
      if (app && app.parentNode) {
        if (app._cleanup) {
          app._cleanup();
        }
        app.parentNode.removeChild(app);
      }
      return this;
    },
  };
}

// Export public API functions
export { createComponent, createApp };
