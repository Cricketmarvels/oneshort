import { ScrollView } from "react-native";

import { FindGrounds } from "@/components/grounds";
import { SP, T } from "@/theme";

export default function GroundsScreen() {
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <FindGrounds />
    </ScrollView>
  );
}
