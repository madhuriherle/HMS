import axios from 'axios';
import { confirmAction, cancelledError } from './utils/actionConfirm';
import { confirmYesNo } from './utils/dialogs';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://187.127.173.27/hmsmma/api/v1';

const api = axios.create({
    baseURL: BASE_URL,
});

const READ_METHODS = ['get', 'head', 'options'];

api.interceptors.request.use(
    async (config) => {
        const token = localStorage.getItem('access_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        // Every change needs a confirmation + reason (sent to the audit log).
        const method = (config.method || 'get').toLowerCase();
        const isAuth = (config.url || '').includes('/auth/');
        // a POST that only previews / looks something up changes nothing, so it never asks for confirmation
        const isReadOnlyPost = /\/(preview|lookup|validate)$/.test((config.url || '').split('?')[0]);
        if (!READ_METHODS.includes(method) && !isAuth && !isReadOnlyPost && !config.headers['X-Action-Reason']) {
            // A caller that already collected a reason (e.g. member delete) passes params.reason.
            const supplied = config.params?.reason;
            const reason = supplied ? String(supplied) : await confirmAction(method, config.url);
            if (!reason) return Promise.reject(cancelledError(config));
            config.headers['X-Action-Reason'] = reason;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const original = error.config;
        const refreshToken = localStorage.getItem('refresh_token');
        const isAuthCall = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');

        if (error.response?.status === 401 && !original._retry && !isAuthCall) {
            if (refreshToken) {
                original._retry = true;
                try {
                    const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
                        refresh_token: refreshToken,
                    });
                    localStorage.setItem('access_token', data.access_token);
                    if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
                    original.headers.Authorization = `Bearer ${data.access_token}`;
                    return api(original);
                } catch (_) {
                    // refresh failed, fall through to logout
                }
            }
            
            // If no refresh token, or refresh failed, log out
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('hms_user_profile');
            if (window.location.pathname !== import.meta.env.BASE_URL) {
                window.location.href = import.meta.env.BASE_URL;
            }
        }

        // A delete the server flagged as "in use": warn, and only resend with force=true if the user insists.
        const inUse = error.response?.status === 409 && error.response?.data?.code === 'IN_USE';
        if (inUse) {
            const { detail: message, can_force: canForce } = error.response.data;
            const method = (original?.method || '').toLowerCase();
            // a delete, or an approver approving a queued delete
            const isDelete = method === 'delete' || (method === 'put' && /\/approve$/.test(original?.url || ''));
            if (isDelete && canForce && !original._forced) {
                const ok = await confirmYesNo({
                    title: 'This record is in use',
                    text: `${message} Delete anyway?`,
                    confirmText: 'Yes, delete anyway',
                    danger: true,
                });
                if (!ok) return Promise.reject(cancelledError(original));
                original._forced = true;
                original.params = { ...(original.params || {}), force: true };
                return api(original);
            }
        }
        return Promise.reject(error);
    }
);

export default api;
