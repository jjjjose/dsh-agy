export function defineTool<T extends { name: string; parameters: unknown; output: { schema: unknown; render: unknown }; execute: unknown }>(definition: T): T {
  if (!definition.name || !definition.output.schema || typeof definition.output.render !== 'function' || typeof definition.execute !== 'function') throw new Error('Invalid tool definition')
  return definition
}
