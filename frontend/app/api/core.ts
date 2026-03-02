import axios from "axios";
import { coreApiBaseUrl } from "./runtime";

export const coreApi = axios.create({
  baseURL: coreApiBaseUrl,
  withCredentials: true,
});
