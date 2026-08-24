const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'foodai.token';

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private browsing / storage disabled
  }
};

export const setToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* non-fatal: the session just will not survive a reload */
  }
};

export class ApiError extends Error {
  constructor(message, { status, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Single fetch wrapper for the whole app: attaches auth, normalises errors into
 * ApiError, and turns network failures into a message a user can act on.
 */
export async function request(path, { method = 'GET', body, params, signal, auth = true } = {}) {
  const url = new URL(`${BASE_URL}/api${path}`, window.location.origin);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
  }

  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(url.toString().replace(window.location.origin, ''), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the server. Check that the API is running.', { status: 0 });
  }

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) return null;
  }

  if (!response.ok) {
    const info = payload?.error ?? {};
    if (response.status === 401 && token) setToken(null);
    throw new ApiError(info.message ?? `Request failed (${response.status})`, {
      status: response.status,
      details: info.details,
    });
  }

  return payload;
}

export const api = {
  // meta
  health: () => request('/health'),
  context: (location) => request('/context', { params: location ? { lat: location.lat, lng: location.lng } : {} }),
  weights: () => request('/recommendations/weights'),
  crowdMethodology: () => request('/crowd/methodology'),
  aiStatus: () => request('/ai/status'),

  // auth
  register: (body) => request('/auth/register', { method: 'POST', body, auth: false }),
  login: (body) => request('/auth/login', { method: 'POST', body, auth: false }),
  me: () => request('/auth/me'),

  // discovery
  nearby: (params) => request('/restaurants/nearby', { params }),
  restaurants: (params) => request('/restaurants', { params }),
  restaurant: (id, params) => request(`/restaurants/${id}`, { params }),
  crowdOutlook: (id, day) => request(`/restaurants/${id}/crowd/outlook`, { params: { day } }),
  crowdStatus: (id) => request(`/restaurants/${id}/crowd`),
  checkIn: (id, body) => request(`/restaurants/${id}/checkin`, { method: 'POST', body }),
  crowdReport: (id, body) => request(`/restaurants/${id}/crowd-report`, { method: 'POST', body }),

  searchFoods: (params) => request('/foods', { params }),
  food: (id) => request(`/foods/${id}`),

  // recommendations
  recommendFoods: (body) => request('/recommendations/foods', { method: 'POST', body }),
  recommendPlaces: (body) => request('/recommendations/places', { method: 'POST', body }),
  alternatives: (body) => request('/recommendations/alternatives', { method: 'POST', body }),
  smartDecision: (body) => request('/recommendations/smart', { method: 'POST', body }),
  recommendationHistory: () => request('/recommendations/history'),

  // ai
  chat: (body) => request('/ai/chat', { method: 'POST', body }),

  // account
  dashboard: (params) => request('/me/dashboard', { params }),
  preferences: () => request('/me/preferences'),
  savePreferences: (body) => request('/me/preferences', { method: 'PUT', body }),
  resetLearning: () => request('/me/preferences/reset-learning', { method: 'POST' }),
  favorites: () => request('/me/favorites'),
  toggleFavorite: (body) => request('/me/favorites', { method: 'POST', body }),
  rate: (body) => request('/me/ratings', { method: 'POST', body }),
  addAddress: (body) => request('/me/addresses', { method: 'POST', body }),
  deleteAddress: (id) => request(`/me/addresses/${id}`, { method: 'DELETE' }),

  // orders
  createOrder: (body) => request('/orders', { method: 'POST', body }),
  orders: () => request('/orders'),
  order: (id) => request(`/orders/${id}`),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: 'POST' }),

  // feedback
  sendFeedback: (body) => request('/feedback', { method: 'POST', body }),
};
