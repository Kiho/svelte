import deindent from '../../utils/deindent';
import Component from '../Component';
import { CompileOptions } from '../../interfaces';
import { stringify } from '../../utils/stringify';
import Renderer from './Renderer';

export default function ssr(
	component: Component,
	options: CompileOptions
) {
	const renderer = new Renderer();

	const { name } = component;

	// create $$render function
	renderer.render(trim(component.fragment.children), Object.assign({
		locate: component.locate
	}, options));

	// TODO concatenate CSS maps
	const css = options.customElement ?
		{ code: null, map: null } :
		component.stylesheet.render(options.filename, true);

	let user_code;

	if (component.javascript) {
		component.rewrite_props();
		user_code = component.javascript;
	} else if (component.ast.js.length === 0 && component.props.length > 0) {
		const props = component.props.map(prop => prop.as).filter(name => name[0] !== '$');

		user_code = `let { ${props.join(', ')} } = $$props;`
	}

	const reactive_stores = Array.from(component.template_references).filter(n => n[0] === '$');
	const reactive_store_values = reactive_stores.map(name => {
		const assignment = `const ${name} = @get_store_value(${name.slice(1)});`;

		return component.options.dev
			? `@validate_store(${name.slice(1)}, '${name.slice(1)}'); ${assignment}`
			: assignment;
	});

	// TODO only do this for props with a default value
	const parent_bindings = component.javascript
		? component.props.map(prop => {
			return `if ($$props.${prop.as} === void 0 && $$bindings.${prop.as} && ${prop.name} !== void 0) $$bindings.${prop.as}(${prop.name});`;
		})
		: [];

	const main = renderer.has_bindings
		? deindent`
			let $$settled;
			let $$rendered;

			do {
				$$settled = true;

				${reactive_store_values}

				${component.reactive_declarations.map(d => d.snippet)}

				$$rendered = \`${renderer.code}\`;
			} while (!$$settled);

			return $$rendered;
		`
		: deindent`
			${reactive_store_values}

			${component.reactive_declarations.map(d => d.snippet)}

			return \`${renderer.code}\`;`;

	const blocks = [
		user_code,
		parent_bindings.join('\n'),
		css.code && `$$result.css.add(#css);`,
		main
	].filter(Boolean);

	return (deindent`
		${css.code && deindent`
		const #css = {
			code: ${css.code ? stringify(css.code) : `''`},
			map: ${css.map ? stringify(css.map.toString()) : 'null'}
		};`}

		${component.module_javascript}

		${component.fully_hoisted.length > 0 && component.fully_hoisted.join('\n\n')}

		const ${name} = @create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
			${blocks.join('\n\n')}
		});
	`).trim();
}

function trim(nodes) {
	let start = 0;
	for (; start < nodes.length; start += 1) {
		const node = nodes[start];
		if (node.type !== 'Text') break;

		node.data = node.data.replace(/^\s+/, '');
		if (node.data) break;
	}

	let end = nodes.length;
	for (; end > start; end -= 1) {
		const node = nodes[end - 1];
		if (node.type !== 'Text') break;

		node.data = node.data.replace(/\s+$/, '');
		if (node.data) break;
	}

	return nodes.slice(start, end);
}
