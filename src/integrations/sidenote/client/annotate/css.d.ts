/**
 * Shared CSS Modules declaration for the integrated client. The build uses
 * Lightning CSS to emit the same class-map shape.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
