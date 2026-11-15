import stylistic from '@stylistic/eslint-plugin';

const decoratorNewline = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    messages: {
      newline: 'Place each decorator and the decorated declaration on separate lines.',
    },
  },
  create(context) {
    const source = context.sourceCode;
    return {
      Decorator(node) {
        const next = source.getTokenAfter(node);
        if (!next || node.loc.end.line !== next.loc.start.line) {
          return;
        }
        context.report({
          node,
          messageId: 'newline',
          fix(fixer) {
            // Preserve comments between the decorator and the declaration.
            const gap = source.text.slice(node.range[1], next.range[0]);
            if (!/^\s*$/.test(gap)) {
              return null;
            }
            const indent = source.lines[node.loc.start.line - 1].match(/^\s*/)[0];
            return fixer.replaceTextRange([node.range[1], next.range[0]], `\n${indent}`);
          },
        });
      },
    };
  },
};

// Reuse Stylistic's comment and overload handling, with Angular input and injection groups.
const memberSpacing = stylistic.rules['lines-between-class-members'];

const classMemberSpacing = {
  meta: memberSpacing.meta,
  defaultOptions: memberSpacing.defaultOptions,
  create(context) {
    function angularFieldKind(member) {
      if (member?.type !== 'PropertyDefinition' || member.value?.type !== 'CallExpression') {
        return false;
      }
      let callee = member.value.callee;
      if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.name === 'required'
      ) {
        callee = callee.object;
      }
      if (callee.type !== 'Identifier') {
        return false;
      }
      let scope = context.sourceCode.getScope(member);
      while (scope && !scope.set.has(callee.name)) {
        scope = scope.upper;
      }
      const definition = scope?.set.get(callee.name)?.defs[0];
      return (
        definition?.node.type === 'ImportSpecifier' &&
        ['input', 'inject'].includes(definition.node.imported.name) &&
        definition.node.parent.source.value === '@angular/core' &&
        definition.node.imported.name
      );
    }
    const wrappedContext = Object.create(context, {
      report: {
        value(descriptor) {
          const members = descriptor.node.parent.body;
          const index = members.indexOf(descriptor.node);
          const kind = angularFieldKind(descriptor.node);
          if (kind && kind === angularFieldKind(members[index - 1])) {
            return;
          }
          context.report(descriptor);
        },
      },
    });
    return memberSpacing.create(wrappedContext);
  },
};

export const typescriptStyle = {
  plugins: {
    '@stylistic': stylistic,
    'project-style': {
      rules: {
        'decorator-newline': decoratorNewline,
        'class-member-spacing': classMemberSpacing,
      },
    },
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': [
      'error',
      { allowExpressions: true, allowTypedFunctionExpressions: true },
    ],
    // The project rule owns spacing, including separate Angular input and injection groups.
    '@stylistic/lines-between-class-members': 'off',
    'project-style/class-member-spacing': [
      'error',
      'always',
      { exceptAfterSingleLine: false, exceptAfterOverload: true },
    ],
    '@stylistic/padding-line-between-statements': [
      'error',
      {
        blankLine: 'always',
        prev: {
          selector:
            'Program > :matches(ExportNamedDeclaration, ExportDefaultDeclaration, ExportAllDeclaration, FunctionDeclaration, ClassDeclaration, VariableDeclaration, TSTypeAliasDeclaration, TSInterfaceDeclaration, TSEnumDeclaration)',
        },
        next: '*',
      },
      {
        blankLine: 'always',
        prev: '*',
        next: {
          selector:
            'Program > :matches(ExportNamedDeclaration, ExportDefaultDeclaration, ExportAllDeclaration, FunctionDeclaration, ClassDeclaration, VariableDeclaration, TSTypeAliasDeclaration, TSInterfaceDeclaration, TSEnumDeclaration)',
        },
      },
      { blankLine: 'always', prev: 'import', next: '*' },
      { blankLine: 'any', prev: 'import', next: 'import' },
    ],
    'project-style/decorator-newline': 'error',
  },
};
