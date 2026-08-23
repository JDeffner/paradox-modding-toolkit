/** esbuild bundles `.css` imports as strings (`--loader:.css=text`). */
declare module "*.css" {
  const text: string;
  export default text;
}
