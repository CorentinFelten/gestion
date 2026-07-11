import axios, { type AxiosInstance } from 'axios';

/**
 * Shared API client. Cookie-based auth (session cookie is httpOnly), so
 * `withCredentials` is required and there is no token to attach manually.
 * Base URL is `/api/v1`; in dev Vite proxies it to the backend, in prod Caddy
 * routes it. Feature agents import `api` and add typed request functions.
 */
export const api: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Narrowed error shape returned by the backend AllExceptionsFilter. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

export function isApiError(err: unknown): err is { response: { data: ApiErrorBody } } {
  return (
    axios.isAxiosError(err) && typeof err.response?.data === 'object' && err.response?.data !== null
  );
}
