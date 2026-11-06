import { ScrollView, View } from "react-native";

import { Chip, Txt } from "@/src/ui";
import { spacing } from "@/src/theme";
import { titleCase } from "@/src/manage/helpers";

/** Labelled single-select chip strip used in admin forms. */
export function ChipPick({ label, options, value, onChange, testID, allowNone }: {
  label: string; options: string[]; value: string | null; onChange: (v: string | null) => void; testID: string; allowNone?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="label">{label}</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {options.map((o) => (
          <Chip key={o} label={titleCase(o)} selected={value === o} testID={`${testID}-${o.toLowerCase()}`}
            onPress={() => onChange(allowNone && value === o ? null : o)} />
        ))}
      </ScrollView>
    </View>
  );
}
