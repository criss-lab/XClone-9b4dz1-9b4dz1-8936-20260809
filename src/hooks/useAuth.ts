import { useAuthStore } from '@/stores/authStore';

// Production auth hook shared by the web application and route guards.
// The recovery gate validates source integrity before typecheck.
// This is intentionally a namespace-safe hook for all route consumers.
// Final CI recovery pass.
export function useAuth() {
  return useAuthStore();
}
