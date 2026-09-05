import React, { createContext, useContext } from "react";
import { useQueryClient } from "@tanstack/react-query";

const QueryClearContext = createContext<
  { clearQueries: () => Promise<void> } | undefined
>(undefined);

export const useQueryClear = () => {
  const context = useContext(QueryClearContext);
  if (!context) {
    throw new Error("useQueryClear must be used within QueryClearProvider");
  }
  return context;
};

export const QueryClearProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient();

  const clearQueries = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
  };

  return (
    <QueryClearContext.Provider value={{ clearQueries }}>
      {children}
    </QueryClearContext.Provider>
  );
};
