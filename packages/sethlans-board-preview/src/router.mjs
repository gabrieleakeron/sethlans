export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, handler) {
    const segments = path.split("/").filter(Boolean);
    this.routes.push({ method, segments, handler });
  }

  get(path, handler) { this.add("GET", path, handler); }
  post(path, handler) { this.add("POST", path, handler); }
  patch(path, handler) { this.add("PATCH", path, handler); }
  delete(path, handler) { this.add("DELETE", path, handler); }

  match(method, pathname) {
    const segments = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== segments.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < segments.length; i++) {
        const routeSeg = route.segments[i];
        if (routeSeg.startsWith(":")) {
          params[routeSeg.slice(1)] = decodeURIComponent(segments[i]);
        } else if (routeSeg !== segments[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}
