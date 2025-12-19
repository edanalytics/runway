# Runway Standard Table

The components in this folder are the Runway-styled version of the various `StdTable*` components. Some design considerations:

- They require the context provided by `StdTableProvider`
- Prefer to wrap the various `StdTable*` components and pass style props. Ideally, we can lean on the standard components to interact with the table context and these components can focus on styling.
- That's a preference and not a rule, however. There will be cases (e.g.`StdTableSearch`) where it's cleaner to rewrite rather than adapt the existing component. And there may also be cases where the functionality of the standard component isn't quite a fit. In both of thse cases, it's OK to write something new, as long as it's compatible with the standard context.
- Prefer to apply styles in these components rather than a theme-level override on the component
- Within the Runway table components, prefer to pass styles to the `StdTable*` components using component-level props. For example, prefer `<StdTable* maxW='10px'>` to `<StdTable* sx={{ maxW:'10px' }}>`. We want to enable callers to easily override default styles. `sx` takes precedence over the component-level attributes, so if a caller attempts to override `maxW` like so `<RunwayStdTable* maxW='50px'>` it will not work if `RunwayStdTable*` implements the default with `sx`.
  - But do use `sx` when needed: to apply styles to child elements within the `StdTable*` component or use a complex css selector.
