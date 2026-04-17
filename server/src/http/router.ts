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
    const pattern = new RegExp(
      '^' +
        path.replace(/:([A-Za-z0-9_]+)/g, (_m, key: string) => {
          keys.push(key);
          return '([^/]+)';
        }) +
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
