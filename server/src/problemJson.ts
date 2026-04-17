export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [ext: string]: unknown;
}

export interface ProblemResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function problemResponse(problem: Problem): ProblemResponse {
  return {
    statusCode: problem.status,
    headers: { 'content-type': 'application/problem+json' },
    body: JSON.stringify(problem),
  };
}

export function problemFromError(
  error: unknown,
  instance: string,
): ProblemResponse {
  if (error && typeof error === 'object' && 'reason' in error && 'message' in error) {
    const reason = String((error as { reason: string }).reason);
    const message = String((error as { message: string }).message);
    const status = statusForReason(reason);
    return problemResponse({
      type: `https://skip-bo.example.com/problems/${reason}`,
      title: titleForReason(reason),
      status,
      detail: message,
      instance,
    });
  }
  return problemResponse({
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    instance,
  });
}

function statusForReason(reason: string): number {
  switch (reason) {
    case 'notFound': return 404;
    case 'forbidden': return 403;
    case 'full':
    case 'started':
    case 'kicked':
    case 'phase':
    case 'selfKick':
    case 'sessionAlreadySeated':
    case 'tooFew':
    case 'openSlots': return 409;
    case 'badIndex':
    case 'badBody': return 422;
    case 'unauthorized': return 401;
    case 'rateLimited': return 429;
    case 'codeExhaustion': return 500;
    default: return 500;
  }
}

function titleForReason(reason: string): string {
  return reason.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}
