declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
declare module "https://esm.sh/@supabase/supabase-js@2" { export function createClient(u: string, k: string, o?: any): any; }
