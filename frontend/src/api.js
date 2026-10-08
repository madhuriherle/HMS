import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://187.127.173.27/hmsmma/api/v1';

const api = axios.create({
    baseURL: BASE_URL,
});

api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('access_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
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

        if (error.response?.status === 401 && !original._retry && refreshToken && !isAuthCall) {
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
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                localStorage.removeItem('hms_user_profile');
                if (window.location.pathname !== '/') {
                    window.location.href = '/';
                }
            }
        }
        return Promise.reject(error);
    }
);

export default api;
