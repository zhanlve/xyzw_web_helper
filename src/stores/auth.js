import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useLocalTokenStore } from "./localTokenManager";

const AUTH_TOKEN_KEY = "token";
const AUTH_USER_KEY = "user";

export const useAuthStore = defineStore("auth", () => {
  // 状态
  const user = ref(null);
  const token = ref(localStorage.getItem(AUTH_TOKEN_KEY) || null);
  const isLoading = ref(false);

  const localTokenStore = useLocalTokenStore();

  const request = async (path, options = {}) => {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    if (token.value) {
      headers.Authorization = `Bearer ${token.value}`;
    }

    const response = await fetch(`/api/v1${path}`, {
      ...options,
      headers,
    });

    const data = await response.json().catch(() => ({
      success: false,
      message: "接口返回格式错误",
    }));

    if (!response.ok) {
      return {
        success: false,
        message: data?.message || "请求失败",
      };
    }

    return data;
  };

  // 计算属性
  const isAuthenticated = computed(() => !!token.value && !!user.value);
  const userInfo = computed(() => user.value);

  // 登录
  const login = async (credentials) => {
    try {
      isLoading.value = true;

      const result = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });

      if (!result.success) {
        return result;
      }

      token.value = result.data.token;
      user.value = result.data.user;

      localStorage.setItem(AUTH_TOKEN_KEY, token.value);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user.value));
      localTokenStore.setUserToken(token.value);

      return { success: true };
    } catch (error) {
      console.error("登录错误:", error);
      return {
        success: false,
        message: error.message || "登录失败，请检查云端接口配置",
      };
    } finally {
      isLoading.value = false;
    }
  };

  // 注册
  const register = async (userInfo) => {
    try {
      isLoading.value = true;

      const result = await request("/auth/register", {
        method: "POST",
        body: JSON.stringify(userInfo),
      });

      return result.success
        ? { success: true, message: result.message || "注册成功，请登录" }
        : result;
    } catch (error) {
      console.error("注册错误:", error);
      return {
        success: false,
        message: error.message || "注册失败，请检查云端接口配置",
      };
    } finally {
      isLoading.value = false;
    }
  };

  // 登出
  const logout = async () => {
    if (token.value) {
      request("/auth/logout", { method: "POST" }).catch(() => {});
    }

    user.value = null;
    token.value = null;

    // 清除本地存储
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem("gameRoles");

    // 清除token管理器中的数据
    localTokenStore.clearUserToken();
    localTokenStore.clearAllGameTokens();
  };

  // 获取用户信息
  const fetchUserInfo = async () => {
    try {
      if (!token.value) return false;

      const result = await request("/auth/user");
      if (!result.success) {
        await logout();
        return false;
      }

      user.value = result.data.user;
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user.value));
      return true;
    } catch (error) {
      console.error("获取用户信息失败:", error);
      await logout();
      return false;
    }
  };

  // 初始化认证状态
  const initAuth = async () => {
    const savedUser = localStorage.getItem(AUTH_USER_KEY);
    if (token.value && savedUser) {
      try {
        user.value = JSON.parse(savedUser);
      } catch (error) {
        console.error("初始化认证失败:", error);
        await logout();
      }
    }

    if (token.value) {
      await fetchUserInfo();
      localTokenStore.initTokenManager();
    }
  };

  return {
    // 状态
    user,
    token,
    isLoading,

    // 计算属性
    isAuthenticated,
    userInfo,

    // 方法
    login,
    register,
    logout,
    fetchUserInfo,
    initAuth,
  };
});
