import { useSonner as useBaseSonner } from "@/providers/sonner-provider";
import type { SonnerConfig } from "@/types/sonner";

export const useSonner = () => {
  const { showSonner, updateSonner, hideSonner, clearAll, sonners } =
    useBaseSonner();

  const success = (
    title: string,
    options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>,
  ) => {
    return showSonner({
      type: "success",
      title,
      ...options,
    });
  };

  const error = (
    title: string,
    options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>,
  ) => {
    return showSonner({
      type: "error",
      title,
      ...options,
    });
  };

  const info = (
    title: string,
    options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>,
  ) => {
    return showSonner({
      type: "info",
      title,
      ...options,
    });
  };

  const warning = (
    title: string,
    options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>,
  ) => {
    return showSonner({
      type: "warning",
      title,
      ...options,
    });
  };

  const loading = (
    title: string,
    options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>,
  ) => {
    return showSonner({
      type: "loading",
      title,
      persistent: true, // Loading sonners should not auto-dismiss
      ...options,
    });
  };

  return {
    // Core methods
    show: showSonner,
    update: updateSonner,
    hide: hideSonner,
    clear: clearAll,
    sonners,

    // Convenience methods
    success,
    error,
    info,
    warning,
    loading,
  };
};
