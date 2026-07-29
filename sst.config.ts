/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "otto",
      removal: input?.stage === "prod" ? "retain" : "remove",
      // protect: ["prod"].includes(input?.stage),
      home: "aws",
      watch: {
        ignore: ["target"],
      },
      providers: {
        aws: {
          profile: "slashforge",
          region: "us-east-1",
        },
      },
    };
  },
  async run() {
    const { script } = await import("./infra/script");
    const { landing } = await import("./infra/landing");
    const { previewApiUrl } = await import("./infra/preview-api");
    const { previewWeb } = await import("./infra/preview-web");
    const { ogFunctionUrl } = await import("./infra/og");
    const { appWeb } = await import("./infra/app-web");

    return {
      script: script.url,
      landing: landing.url,
      appWeb: appWeb.url,
      previewApi: previewApiUrl,
      previewWeb: previewWeb.url,
      ogFunction: ogFunctionUrl,
    };
  },
});
