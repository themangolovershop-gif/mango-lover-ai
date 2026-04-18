import { Router, type RequestHandler } from "express";

import { NotImplementedError } from "@/backend/shared/lib/errors/app-error";
import type { RouteScaffoldResponse } from "@/backend/shared/types/api";

type ScaffoldEndpoint = {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  feature: string;
  availableInPhase: string;
};

function buildHealthHandler(moduleName: string): RequestHandler {
  return (_request, response) => {
    const body: RouteScaffoldResponse = {
      success: true,
      data: {
        module: moduleName,
        status: "scaffolded",
        phase: "A",
      },
    };

    response.status(200).json(body);
  };
}

function buildNotImplementedHandler(
  moduleName: string,
  endpoint: ScaffoldEndpoint
): RequestHandler {
  return (_request, _response, next) => {
    next(
      new NotImplementedError(
        `${moduleName} ${endpoint.feature} is scaffolded in Phase A and scheduled for ${endpoint.availableInPhase}.`
      )
    );
  };
}

export function createScaffoldRouter(
  moduleName: string,
  endpoints: ScaffoldEndpoint[] = []
) {
  const router = Router();

  router.get("/health", buildHealthHandler(moduleName));

  for (const endpoint of endpoints) {
    router[endpoint.method](
      endpoint.path,
      buildNotImplementedHandler(moduleName, endpoint)
    );
  }

  return router;
}
