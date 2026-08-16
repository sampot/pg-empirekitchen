export default {
  async fetch(request) {
    return Response.json({
      ok: true,
      name: "pg-empirekitchen",
      path: new URL(request.url).pathname,
    });
  },
};
