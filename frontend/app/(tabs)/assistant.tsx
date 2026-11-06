import { useEffect, useRef, useState } from "react";
import { FlatList, Platform, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { fetch as expoFetch } from "expo/fetch";
import Animated, { FadeInUp, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Image } from "expo-image";

import { api, API_URL, getToken } from "@/src/api";
import { usesNativeTabs } from "@/src/navigation";
import { useToast } from "@/src/toast";
import { Chip, Icon, IconBtn, Pressy, Txt, centered, useLayout, webNoOutline } from "@/src/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Msg = { id: string; role: "user" | "assistant"; content: string; error?: boolean };
const SUGGESTIONS = [
  "How many north-facing units are available in Skyline Heights Tower A?",
  "Which leads should I call today?",
  "Summarize my pipeline this month",
  "Recommend units for Ananya Gupta",
];

function Thinking() {
  const o = useSharedValue(0.3);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View style={[a, { width: 28, height: 24 }]} testID="ai-thinking">
      <Image source={require("../../assets/images/logo.png")} style={{ width: 28, height: 24 }} contentFit="contain" />
    </Animated.View>
  );
}

// Minimal markdown for AI replies: **bold**, # headings and "- " bullets.
function RichText({ text }: { text: string }) {
  const clean = text.replace(/^#{1,6}\s*/gm, "").replace(/^\s*[-*]\s+/gm, "• ");
  return (
    <>
      {clean.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <Txt key={i} variant="bodyStrong">{part.slice(2, -2)}</Txt>
        ) : (
          part
        ),
      )}
    </>
  );
}

export default function Assistant() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { gutter } = useLayout();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList>(null);
  const history = useQuery({ queryKey: ["ai-history"], queryFn: () => api<any[]>("/ai/history") });

  useEffect(() => {
    if (history.data) setMsgs(history.data.map((m) => ({ id: m.id, role: m.role, content: m.content })));
  }, [history.data]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    const aid = `a-${Date.now()}`;
    setMsgs((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: t }, { id: aid, role: "assistant", content: "" }]);
    setBusy(true);
    const patch = (fn: (c: Msg) => Msg) => setMsgs((m) => m.map((x) => (x.id === aid ? fn(x) : x)));
    try {
      const token = await getToken();
      const f: any = Platform.OS === "web" ? fetch : expoFetch;
      const res = await f(`${API_URL}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: t }),
      });
      if (!res.ok) {
        let detail = "AI request failed";
        try { detail = (await res.json()).detail ?? detail; } catch {}
        throw new Error(detail);
      }
      const handle = (chunk: string) => {
        chunk.split("\n\n").forEach((line) => {
          const l = line.trim();
          if (!l.startsWith("data:")) return;
          try {
            const ev = JSON.parse(l.slice(5));
            if (ev.delta) patch((c) => ({ ...c, content: c.content + ev.delta }));
            if (ev.error) patch((c) => ({ ...c, content: ev.error, error: true }));
          } catch {}
        });
      };
      if (res.body?.getReader) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const idx = buf.lastIndexOf("\n\n");
          if (idx >= 0) {
            handle(buf.slice(0, idx + 2));
            buf = buf.slice(idx + 2);
          }
        }
        if (buf) handle(buf);
      } else {
        handle(await res.text());
      }
    } catch (e: any) {
      patch((c) => ({ ...c, content: e.message ?? "Message failed to send.", error: true }));
      toast.show(e.message ?? "AI unavailable", "error");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    await api("/ai/history", { method: "DELETE" });
    setMsgs([]);
    toast.show("Conversation cleared", "info");
  };

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + spacing.sm, paddingHorizontal: gutter }]}>
        <View style={{ flex: 1 }}>
          <Txt variant="title">RCortexa AI</Txt>
          <Txt variant="caption">Ask anything about your live CRM data</Txt>
        </View>
        {msgs.length > 0 && <IconBtn icon="trash-outline" testID="ai-clear-button" onPress={clear} />}
      </View>
      <KeyboardAvoidingView behavior="translate-with-padding" style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={msgs}
          keyExtractor={(m) => m.id}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          contentContainerStyle={{ ...centered, padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: "flex-end", gap: spacing.md }} testID="ai-empty-state">
              <Icon name="sparkles" size={28} color={colors.brandTertiary} />
              <Txt variant="h2">What would you like to know?</Txt>
              <Txt variant="caption">Inventory counts, lead priorities, pipeline summaries and unit recommendations — answered from live data.</Txt>
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                {SUGGESTIONS.map((q, i) => (
                  <Pressy key={q} testID={`ai-suggestion-${i}`} onPress={() => send(q)} style={s.suggestion}>
                    <Txt variant="body" style={{ flex: 1 }}>{q}</Txt>
                    <Icon name="arrow-up-circle" size={20} color={colors.brandSecondary} />
                  </Pressy>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <Animated.View entering={FadeInUp.duration(220)} style={[s.bubble, item.role === "user" ? s.userBubble : s.aiBubble, item.error && { borderColor: colors.error }]} testID={`chat-message-${item.role}`}>
              {item.role === "assistant" && item.content === "" ? (
                <Thinking />
              ) : (
                <Txt variant="body" color={item.error ? colors.error : colors.onSurface}>
                  {item.error && "⚠ "}
                  <RichText text={item.content} />
                </Txt>
              )}
            </Animated.View>
          )}
        />
        {msgs.length > 0 && !busy && (
          <View style={{ paddingVertical: spacing.xs }}>
            <View style={{ flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, flexWrap: "nowrap" }}>
              <Chip label="Which leads are hot?" onPress={() => send("Which leads are hot right now and why?")} testID="ai-quick-hot" />
              <Chip label="Available units" onPress={() => send("Summarize available units by project, tower and facing")} testID="ai-quick-units" />
            </View>
          </View>
        )}
        <View style={[s.inputBar, { paddingBottom: bottomChrome + spacing.md, paddingHorizontal: gutter }]}>
          <TextInput
            testID="ai-chat-input"
            value={input}
            onChangeText={setInput}
            placeholder="Ask RCortexa AI…"
            placeholderTextColor={colors.muted}
            style={s.input}
            multiline
            onSubmitEditing={() => send(input)}
          />
          <Pressy testID="ai-send-button" onPress={() => send(input)} style={[s.send, { opacity: input.trim() && !busy ? 1 : 0.4 }]}>
            <Icon name="arrow-up" size={20} color={colors.onBrandPrimary} />
          </Pressy>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  suggestion: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border },
  bubble: { maxWidth: "88%", padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  userBubble: { alignSelf: "flex-end", backgroundColor: c.surfaceTertiary, borderColor: c.surfaceTertiary, borderBottomRightRadius: radius.sm },
  aiBubble: { alignSelf: "flex-start", backgroundColor: c.surfaceSecondary, borderColor: c.border, borderBottomLeftRadius: radius.sm },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.divider },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary, color: c.onSurface, paddingHorizontal: spacing.lg, paddingTop: 14, paddingBottom: 14, fontFamily: fonts.medium, fontSize: 15, borderWidth: 1, borderColor: c.border, ...webNoOutline },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
}));
