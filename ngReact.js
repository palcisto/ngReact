// # ngInferno
// ### Use Inferno Components inside of your Angular applications
//
// Composed of
// - infernoComponent (generic directive for delegating off to Inferno Components)
// - infernoDirective (factory for creating specific directives that correspond to infernoComponent directives)


(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // CommonJS
    module.exports = factory(require('inferno'), require('angular'));
  } else if (typeof define === 'function' && define.amd) {
    // AMD
    define(['inferno', 'angular'], function (inferno, angular) {
      return (root.ngInferno = factory(inferno, angular));
    });
  } else {
    // Global Variables
    root.ngInferno = factory(root.Inferno, root.angular);
  }
}(this, function ngInferno(Inferno, angular) {
  'use strict';

  // get a inferno component from name (components can be an angular injectable e.g. value, factory or
  // available on window
  function getInfernoComponent( name, $injector ) {
    // if name is a function assume it is component and return it
    if (angular.isFunction(name)) {
      return name;
    }

    // a Inferno component name must be specified
    if (!name) {
      throw new Error('InfernoComponent name attribute must be specified');
    }

    // ensure the specified Inferno component is accessible, and fail fast if it's not
    var infernoComponent;
    try {
      infernoComponent = $injector.get(name);
    } catch(e) { }

    if (!infernoComponent) {
      try {
        infernoComponent = name.split('.').reduce(function(current, namePart) {
          return current[namePart];
        }, window);
      } catch (e) { }
    }

    if (!infernoComponent) {
      throw Error('Cannot find inferno component ' + name);
    }

    return infernoComponent;
  }

  // wraps a function with scope.$apply, if already applied just return
  function applied(fn, scope) {
    if (fn.wrappedInApply) {
      return fn;
    }
    var wrapped = function() {
      var args = arguments;
      var phase = scope.$root.$$phase;
      if (phase === "$apply" || phase === "$digest") {
        return fn.apply(null, args);
      } else {
        return scope.$apply(function() {
          return fn.apply( null, args );
        });
      }
    };
    wrapped.wrappedInApply = true;
    return wrapped;
  }

  /**
   * wraps functions on obj in scope.$apply
   *
   * keeps backwards compatibility, as if propsConfig is not passed, it will
   * work as before, wrapping all functions and won't wrap only when specified.
   *
   * @version 0.4.1
   * @param obj inferno component props
   * @param scope current scope
   * @param propsConfig configuration object for all properties
   * @returns {Object} props with the functions wrapped in scope.$apply
   */
  function applyFunctions(obj, scope, propsConfig) {
    return Object.keys(obj || {}).reduce(function(prev, key) {
      var value = obj[key];
      var config = (propsConfig || {})[key] || {};
      /**
       * wrap functions in a function that ensures they are scope.$applied
       * ensures that when function is called from a Inferno component
       * the Angular digest cycle is run
       */
      prev[key] = angular.isFunction(value) && config.wrapApply !== false
        ? applied(value, scope)
        : value;

      return prev;
    }, {});
  }

  /**
   *
   * @param watchDepth (value of HTML watch-depth attribute)
   * @param scope (angular scope)
   *
   * Uses the watchDepth attribute to determine how to watch props on scope.
   * If watchDepth attribute is NOT reference or collection, watchDepth defaults to deep watching by value
   */
  function watchProps (watchDepth, scope, watchExpressions, listener){
    var supportsWatchCollection = angular.isFunction(scope.$watchCollection);
    var supportsWatchGroup = angular.isFunction(scope.$watchGroup);

    var watchGroupExpressions = [];
    watchExpressions.forEach(function(expr){
      var actualExpr = getPropExpression(expr);
      var exprWatchDepth = getPropWatchDepth(watchDepth, expr);

      if (exprWatchDepth === 'collection' && supportsWatchCollection) {
        scope.$watchCollection(actualExpr, listener);
      } else if (exprWatchDepth === 'reference' && supportsWatchGroup) {
        watchGroupExpressions.push(actualExpr);
      } else {
        scope.$watch(actualExpr, listener, (exprWatchDepth !== 'reference'));
      }
    });

    if (watchGroupExpressions.length) {
      scope.$watchGroup(watchGroupExpressions, listener);
    }
  }

  // render Inferno component, with scope[attrs.props] being passed in as the component props
  function renderComponent(component, props, scope, elem) {
    scope.$evalAsync(function() {
      Inferno.render(infernoCreateElement(component, props), elem[0]);
    });
  }

  // get prop name from prop (string or array)
  function getPropName(prop) {
    return (Array.isArray(prop)) ? prop[0] : prop;
  }

  // get prop name from prop (string or array)
  function getPropConfig(prop) {
    return (Array.isArray(prop)) ? prop[1] : {};
  }

  // get prop expression from prop (string or array)
  function getPropExpression(prop) {
    return (Array.isArray(prop)) ? prop[0] : prop;
  }

  // find the normalized attribute knowing that Inferno props accept any type of capitalization
  function findAttribute(attrs, propName) {
    var index = Object.keys(attrs).filter(function (attr) {
      return attr.toLowerCase() === propName.toLowerCase();
    })[0];
    return attrs[index];
  }

  // get watch depth of prop (string or array)
  function getPropWatchDepth(defaultWatch, prop) {
    var customWatchDepth = (
      Array.isArray(prop) &&
      angular.isObject(prop[1]) &&
      prop[1].watchDepth
    );
    return customWatchDepth || defaultWatch;
  }

  // # infernoComponent
  // Directive that allows Inferno components to be used in Angular templates.
  //
  // Usage:
  //     <inferno-component name="Hello" props="name"/>
  //
  // This requires that there exists an injectable or globally available 'Hello' Inferno component.
  // The 'props' attribute is optional and is passed to the component.
  //
  // The following would would create and register the component:
  //
  //     var module = angular.module('ace.inferno.components');
  //     module.value('Hello', Inferno.createClass({
  //         render: function() {
  //             return <div>Hello {this.props.name}</div>;
  //         }
  //     }));
  //
  var infernoComponent = function($injector) {
    return {
      restrict: 'E',
      replace: true,
      link: function(scope, elem, attrs) {
        var infernoComponent = getInfernoComponent(attrs.name, $injector);

        var renderMyComponent = function() {
          var scopeProps = scope.$eval(attrs.props);
          var props = applyFunctions(scopeProps, scope);

          renderComponent(infernoComponent, props, scope, elem);
        };

        // If there are props, re-render when they change
        attrs.props ?
          watchProps(attrs.watchDepth, scope, [attrs.props], renderMyComponent) :
          renderMyComponent();

        // cleanup when scope is destroyed
        scope.$on('$destroy', function() {
          if (!attrs.onScopeDestroy) {
            InfernoDOM.unmountComponentAtNode(elem[0]);
          } else {
            scope.$eval(attrs.onScopeDestroy, {
              unmountComponent: InfernoDOM.unmountComponentAtNode.bind(this, elem[0])
            });
          }
        });
      }
    };
  };

  // # infernoDirective
  // Factory function to create directives for Inferno components.
  //
  // With a component like this:
  //
  //     var module = angular.module('ace.inferno.components');
  //     module.value('Hello', Inferno.createClass({
  //         render: function() {
  //             return <div>Hello {this.props.name}</div>;
  //         }
  //     }));
  //
  // A directive can be created and registered with:
  //
  //     module.directive('hello', function(infernoDirective) {
  //         return infernoDirective('Hello', ['name']);
  //     });
  //
  // Where the first argument is the injectable or globally accessible name of the Inferno component
  // and the second argument is an array of property names to be watched and passed to the Inferno component
  // as props.
  //
  // This directive can then be used like this:
  //
  //     <hello name="name"/>
  //
  var infernoDirective = function($injector) {
    return function(infernoComponentName, props, conf, injectableProps) {
      var directive = {
        restrict: 'E',
        replace: true,
        link: function(scope, elem, attrs) {
          var infernoComponent = getInfernoComponent(infernoComponentName, $injector);

          // if props is not defined, fall back to use the Inferno component's propTypes if present
          props = props || Object.keys(infernoComponent.propTypes || {});

          // for each of the properties, get their scope value and set it to scope.props
          var renderMyComponent = function() {
            var scopeProps = {}, config = {};
            props.forEach(function(prop) {
              var propName = getPropName(prop);
              scopeProps[propName] = scope.$eval(findAttribute(attrs, propName));
              config[propName] = getPropConfig(prop);
            });
            scopeProps = applyFunctions(scopeProps, scope, config);
            scopeProps = angular.extend({}, scopeProps, injectableProps);
            renderComponent(infernoComponent, scopeProps, scope, elem);
          };

          // watch each property name and trigger an update whenever something changes,
          // to update scope.props with new values
          var propExpressions = props.map(function(prop){
            return (Array.isArray(prop)) ?
              [attrs[getPropName(prop)], getPropConfig(prop)] :
              attrs[prop];
          });

          watchProps(attrs.watchDepth, scope, propExpressions, renderMyComponent);

          renderMyComponent();

          // cleanup when scope is destroyed
          scope.$on('$destroy', function() {
            if (!attrs.onScopeDestroy) {
              InfernoDOM.unmountComponentAtNode(elem[0]);
            } else {
              scope.$eval(attrs.onScopeDestroy, {
                unmountComponent: InfernoDOM.unmountComponentAtNode.bind(this, elem[0])
              });
            }
          });
        }
      };
      return angular.extend(directive, conf);
    };
  };

  // create the end module without any dependencies, including infernoComponent and infernoDirective
  return angular.module('inferno', [])
    .directive('infernoComponent', ['$injector', infernoComponent])
    .factory('infernoDirective', ['$injector', infernoDirective]);
}));
