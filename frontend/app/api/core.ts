import axios from "axios";

const CORE_API_BASE_URL = import.meta.env.VITE_CORE_API ?? "http://localhost:5000";
const CORE_API_TOKEN = import.meta.env.VITE_API_TOKEN ?? "";

export const coreApi = axios.create({
  baseURL: CORE_API_BASE_URL,
  headers: CORE_API_TOKEN ? { "x-api-token": CORE_API_TOKEN } : undefined,
});