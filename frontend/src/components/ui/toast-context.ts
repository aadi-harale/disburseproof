import { createContext, useContext } from "react";

export type ToastTone = "success" | "danger" | "info";

export interface ToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
  href?: string;
}

export const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

export function useToast(): (toast: ToastInput) => void {
  return useContext(ToastContext);
}
