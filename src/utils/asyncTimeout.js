export const REQUEST_TIMEOUT_CODE = 'REQUEST_TIMEOUT';

export class RequestTimeoutError extends Error {
  constructor(message = 'The request took too long to complete.') {
    super(message);
    this.name = 'RequestTimeoutError';
    this.code = REQUEST_TIMEOUT_CODE;
  }
}

export const isTimeoutError = (error) => (
  error?.code === REQUEST_TIMEOUT_CODE
  || error?.name === 'RequestTimeoutError'
);

export const withTimeout = async (
  operation,
  {
    timeoutMs = 15000,
    message = 'The request took too long to complete.',
  } = {},
) => {
  let timeoutId;
  const operationPromise = typeof operation === 'function'
    ? Promise.resolve().then(operation)
    : Promise.resolve(operation);

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new RequestTimeoutError(message));
    }, Math.max(1, Number(timeoutMs) || 15000));
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};
