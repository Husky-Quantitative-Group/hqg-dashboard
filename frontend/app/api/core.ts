import axios from "axios";

export const coreApi = axios.create({
  baseURL: "/api",
  withCredentials: true,
});
