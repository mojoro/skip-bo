import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void | Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler): void {
    const keys: string[] = [];
    const escapeLiteral = (seg: string) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      '^' +
        path.split(/(:[A-Za-z0-9_]+)/).map((seg, i) => {
          if (i % 2 === 1) {
            keys.push(seg.slice(1));
            return '([^/]+)';
          }
          return escapeLiteral(seg);
        }).join('') +
        '/?$',
    );
    this.routes.push({ method: method.toUpperCase(), pattern, keys, handler });
  }

  match(method: string, path: string): { handler: RouteHandler; params: Record<string, string> } | null {
    const up = method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== up) continue;
      const m = path.match(route.pattern);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
      return { handler: route.handler, params };
    }
    return null;
  }
}
