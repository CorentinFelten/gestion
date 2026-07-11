/**
 * Minimal ambient declaration for `multer` (SEC-10). The package ships no types
 * and `@types/multer` is intentionally not added (no package.json changes), so
 * we declare only the `diskStorage` engine we use. NestJS's `MulterOptions`
 * already inlines the file-callback shape, so nothing else is needed.
 */
declare module 'multer' {
  export function diskStorage(opts: {
    destination: (
      req: unknown,
      file: unknown,
      cb: (err: Error | null, destination: string) => void,
    ) => void;
    filename: (
      req: unknown,
      file: { originalname: string },
      cb: (err: Error | null, filename: string) => void,
    ) => void;
  }): unknown;
}
