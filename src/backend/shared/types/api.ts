export type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
};

export type HealthResponse = {
  success: true;
  data: {
    service: string;
    status: "ok";
    environment: string;
    timestamp: string;
  };
};

export type RouteScaffoldResponse = {
  success: true;
  data: {
    module: string;
    status: "scaffolded";
    phase: "A";
  };
};
