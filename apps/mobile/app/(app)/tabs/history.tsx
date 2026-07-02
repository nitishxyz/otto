import { Box, Text } from "@/components/ui/primitives";

export default function HistoryTab() {
  return (
    <Box flex center background="plain">
      <Text size="xl" weight="bold">History</Text>
      <Text size="md" mode="subtle">Recent activity</Text>
    </Box>
  );
}
