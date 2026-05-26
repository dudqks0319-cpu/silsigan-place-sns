import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getSignalColor,
  nationwidePlaces,
  questionTypeOptions,
  quickQuestionExamples,
  recentReports,
  serviceScope,
  type NationwidePlace,
  type RegionName,
} from "./src/silsiganExperience";

type TabKey = "home" | "nearby" | "report" | "question" | "my";

const tabs: { key: TabKey; label: string; symbol: string }[] = [
  { key: "home", label: "홈", symbol: "⌂" },
  { key: "nearby", label: "내주변", symbol: "◇" },
  { key: "report", label: "올리기", symbol: "+" },
  { key: "question", label: "물어보기", symbol: "?" },
  { key: "my", label: "마이", symbol: "○" },
];

const crowdOptions = ["한산", "보통", "혼잡", "매우 혼잡"] as const;
const parkingOptions = ["여유", "보통", "부족", "만차"] as const;

export default function App() {
  return (
    <SafeAreaProvider>
      <SilsiganMobileApp />
    </SafeAreaProvider>
  );
}

function SilsiganMobileApp() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [selectedRegion, setSelectedRegion] = useState<RegionName | "전국">("전국");
  const [selectedPlaceId, setSelectedPlaceId] = useState(nationwidePlaces[0].id);
  const selectedPlace = nationwidePlaces.find((place) => place.id === selectedPlaceId) ?? nationwidePlaces[0];

  const visiblePlaces = useMemo(() => {
    if (selectedRegion === "전국") {
      return nationwidePlaces;
    }

    return nationwidePlaces.filter((place) => place.region === selectedRegion);
  }, [selectedRegion]);

  const openPlace = (place: NationwidePlace) => {
    setSelectedPlaceId(place.id);
    setActiveTab("nearby");
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.kicker}>{serviceScope.label}</Text>
          <Text style={styles.title}>#실시간</Text>
        </View>
        <View style={styles.trustChip}>
          <Text style={styles.trustSymbol}>✓</Text>
          <Text style={styles.trustText}>현장 인증</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 112 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "home" && (
          <HomeScreen
            onOpenPlace={openPlace}
            onSelectRegion={setSelectedRegion}
            onTabChange={setActiveTab}
            selectedRegion={selectedRegion}
            visiblePlaces={visiblePlaces}
          />
        )}
        {activeTab === "nearby" && (
          <NearbyScreen onOpenPlace={openPlace} selectedPlace={selectedPlace} visiblePlaces={visiblePlaces} />
        )}
        {activeTab === "report" && <ReportScreen place={selectedPlace} />}
        {activeTab === "question" && <QuestionScreen place={selectedPlace} />}
        {activeTab === "my" && <MyScreen />}
      </ScrollView>

      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[styles.navButton, isActive && styles.navButtonActive]}
            >
              <Text style={[styles.navSymbol, isActive && styles.navTextActive]}>{tab.symbol}</Text>
              <Text style={[styles.navLabel, isActive && styles.navTextActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </KeyboardAvoidingView>
  );
}

function HomeScreen({
  onOpenPlace,
  onSelectRegion,
  onTabChange,
  selectedRegion,
  visiblePlaces,
}: {
  onOpenPlace: (place: NationwidePlace) => void;
  onSelectRegion: (region: RegionName | "전국") => void;
  onTabChange: (tab: TabKey) => void;
  selectedRegion: RegionName | "전국";
  visiblePlaces: NationwidePlace[];
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.searchBox}>
        <Text style={styles.searchSymbol}>⌕</Text>
        <TextInput
          accessibilityLabel="장소 검색"
          placeholder="지역, 장소, 주차, 줄 검색"
          placeholderTextColor="#98a2b3"
          style={styles.searchInput}
        />
      </View>

      <View style={styles.liveSummary}>
        <View style={styles.liveSummaryHeader}>
          <Text style={styles.sectionKicker}>지금 많이 확인</Text>
          <Text style={styles.liveTime}>최근 10분</Text>
        </View>
        <Text style={styles.liveTitle}>전국 현장 제보가 먼저 보입니다.</Text>
        <Text style={styles.liveBody}>{serviceScope.shortCopy}</Text>
      </View>

      <View style={styles.quickActionRow}>
        <Pressable style={styles.primaryAction} onPress={() => onTabChange("report")}>
          <Text style={styles.primaryActionText}>현장 인증하고 올리기</Text>
        </Pressable>
        <Pressable style={styles.secondaryAction} onPress={() => onTabChange("question")}>
          <Text style={styles.secondaryActionText}>지금 물어보기</Text>
        </Pressable>
      </View>

      <SectionTitle title="방금 올라온 현장" meta="신뢰도 우선" />
      <View style={styles.reportList}>
        {recentReports.map((report) => (
          <Pressable
            key={report.id}
            onPress={() => {
              const place = nationwidePlaces.find((candidate) => candidate.id === report.placeId);
              if (place) {
                onOpenPlace(place);
              }
            }}
            style={styles.reportCard}
          >
            <View style={[styles.reportBadge, report.verified ? styles.verifiedBadge : styles.unverifiedBadge]}>
              <Text style={styles.reportBadgeText}>{report.verified ? "인증" : "참고"}</Text>
            </View>
            <View style={styles.cardTextBlock}>
              <Text style={styles.cardTitle}>{report.placeName}</Text>
              <Text style={styles.cardBody}>{report.headline}</Text>
              <Text style={styles.cardMeta}>{report.stateLine}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      <SectionTitle title="전국 지역" meta={`${visiblePlaces.length}곳 표시`} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regionRow}>
        {(["전국", ...serviceScope.regions] as (RegionName | "전국")[]).map((region) => (
          <Pressable
            key={region}
            onPress={() => onSelectRegion(region)}
            style={[styles.regionChip, selectedRegion === region && styles.regionChipActive]}
          >
            <Text style={[styles.regionText, selectedRegion === region && styles.regionTextActive]}>{region}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.placeList}>
        {visiblePlaces.slice(0, 5).map((place) => (
          <PlaceCard key={place.id} onPress={() => onOpenPlace(place)} place={place} />
        ))}
      </View>
    </View>
  );
}

function NearbyScreen({
  onOpenPlace,
  selectedPlace,
  visiblePlaces,
}: {
  onOpenPlace: (place: NationwidePlace) => void;
  selectedPlace: NationwidePlace;
  visiblePlaces: NationwidePlace[];
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.mapPanel}>
        <Text style={styles.sectionKicker}>전국 지도</Text>
        <Text style={styles.mapTitle}>{selectedPlace.name}</Text>
        <Text style={styles.mapBody}>{selectedPlace.summary}</Text>
        <View style={styles.mapCanvas}>
          {visiblePlaces.slice(0, 6).map((place, index) => (
            <Pressable
              key={place.id}
              onPress={() => onOpenPlace(place)}
              style={[
                styles.mapPin,
                {
                  left: `${14 + ((index * 19) % 68)}%`,
                  top: `${20 + ((index * 23) % 58)}%`,
                  backgroundColor: getSignalColor(place.signalTone),
                },
              ]}
            >
              <Text style={styles.mapPinText}>{place.region}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.filterRow}>
        {["전체", "주차", "줄", "혼잡", "사진"].map((filter, index) => (
          <View key={filter} style={[styles.filterChip, index === 0 && styles.filterChipActive]}>
            <Text style={[styles.filterText, index === 0 && styles.filterTextActive]}>{filter}</Text>
          </View>
        ))}
      </View>

      <SectionTitle title="확인할 장소" meta="상태순" />
      <View style={styles.placeList}>
        {visiblePlaces.map((place) => (
          <PlaceCard key={place.id} onPress={() => onOpenPlace(place)} place={place} />
        ))}
      </View>
    </View>
  );
}

function ReportScreen({ place }: { place: NationwidePlace }) {
  const [crowd, setCrowd] = useState<(typeof crowdOptions)[number]>("보통");
  const [parking, setParking] = useState<(typeof parkingOptions)[number]>("부족");
  const [memo, setMemo] = useState("");

  return (
    <View style={styles.stack}>
      <View style={styles.formHero}>
        <Text style={styles.sectionKicker}>10초 현장 공유</Text>
        <Text style={styles.formTitle}>{place.name}</Text>
        <Text style={styles.formBody}>사진은 선택입니다. 먼저 현장 인증과 상태만 빠르게 남기세요.</Text>
      </View>

      <Pressable style={styles.primaryWideButton}>
        <Text style={styles.primaryWideButtonText}>현장 인증하고 올리기</Text>
      </Pressable>

      <ChoiceGroup label="사람" options={crowdOptions} value={crowd} onChange={setCrowd} />
      <ChoiceGroup label="주차" options={parkingOptions} value={parking} onChange={setParking} />

      <TextInput
        accessibilityLabel="한 줄 코멘트"
        multiline
        onChangeText={setMemo}
        placeholder="예: 입구 줄은 짧고 주차장은 거의 찼어요."
        placeholderTextColor="#98a2b3"
        style={styles.memoInput}
        value={memo}
      />

      <View style={styles.policyCard}>
        <Text style={styles.policyTitle}>개인정보 보호</Text>
        <Text style={styles.policyText}>정확한 좌표는 공개하지 않고 거리 구간만 확인합니다. 얼굴, 차량번호, 진료 정보가 보이면 올리지 마세요.</Text>
      </View>

      <View style={styles.footerCtaSpacer}>
        <Pressable style={styles.secondaryWideButton}>
          <Text style={styles.secondaryWideButtonText}>사진은 나중에 추가</Text>
        </Pressable>
      </View>
    </View>
  );
}

function QuestionScreen({ place }: { place: NationwidePlace }) {
  const [questionType, setQuestionType] = useState<(typeof questionTypeOptions)[number]>("주차");
  const [question, setQuestion] = useState("");

  return (
    <View style={styles.stack}>
      <View style={styles.formHero}>
        <Text style={styles.sectionKicker}>여기 지금 어때요?</Text>
        <Text style={styles.formTitle}>{place.name}</Text>
        <Text style={styles.formBody}>근처 사람이 한 번에 답할 수 있게 짧게 물어보세요.</Text>
      </View>

      <View style={styles.ticketCard}>
        <Text style={styles.ticketTitle}>내 물어보기권 3개</Text>
        <Text style={styles.ticketText}>{questionType === "사진 요청" ? "사진 요청은 2개 차감됩니다." : "이번 질문은 1개 차감됩니다."}</Text>
      </View>

      <View style={styles.exampleWrap}>
        {quickQuestionExamples.map((example) => (
          <Pressable key={example} onPress={() => setQuestion(example)} style={styles.exampleChip}>
            <Text style={styles.exampleText}>{example}</Text>
          </Pressable>
        ))}
      </View>

      <ChoiceGroup label="질문 유형" options={questionTypeOptions} value={questionType} onChange={setQuestionType} />

      <TextInput
        accessibilityLabel="물어보기 내용"
        multiline
        onChangeText={setQuestion}
        placeholder="예: 지금 공영주차장 빈 자리 있나요?"
        placeholderTextColor="#98a2b3"
        style={styles.memoInput}
        value={question}
      />

      <Pressable style={[styles.primaryWideButton, question.trim().length < 4 && styles.disabledButton]}>
        <Text style={styles.primaryWideButtonText}>물어보기 등록</Text>
      </Pressable>
    </View>
  );
}

function MyScreen() {
  return (
    <View style={styles.stack}>
      <View style={styles.profileCard}>
        <Text style={styles.sectionKicker}>내 활동</Text>
        <Text style={styles.formTitle}>전국 현장 신뢰도 86</Text>
        <Text style={styles.formBody}>현장 인증 제보가 많을수록 질문 답변 우선순위가 올라갑니다.</Text>
      </View>
      <View style={styles.statsGrid}>
        <StatCard label="물어보기권" value="3개" />
        <StatCard label="제보" value="2건" />
        <StatCard label="답변" value="1건" />
        <StatCard label="숨김 사용자" value="0명" />
      </View>
    </View>
  );
}

function ChoiceGroup<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: readonly T[];
  value: T;
}) {
  return (
    <View>
      <Text style={styles.choiceLabel}>{label}</Text>
      <View style={styles.choiceGrid}>
        {options.map((option) => {
          const isActive = option === value;
          return (
            <Pressable key={option} onPress={() => onChange(option)} style={[styles.choiceChip, isActive && styles.choiceChipActive]}>
              <Text style={[styles.choiceText, isActive && styles.choiceTextActive]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PlaceCard({ onPress, place }: { onPress: () => void; place: NationwidePlace }) {
  return (
    <Pressable onPress={onPress} style={styles.placeCard}>
      <View style={[styles.signalRail, { backgroundColor: getSignalColor(place.signalTone) }]} />
      <View style={styles.cardTextBlock}>
        <View style={styles.placeHeaderLine}>
          <Text style={styles.cardTitle}>{place.name}</Text>
          <Text style={styles.regionBadge}>{place.region}</Text>
        </View>
        <Text style={styles.cardBody}>{place.summary}</Text>
        <Text style={styles.cardMeta}>
          {place.category} · 사람 {place.crowd} · 주차 {place.parking} · {place.updatedAt}
        </Text>
      </View>
    </Pressable>
  );
}

function SectionTitle({ meta, title }: { meta: string; title: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{title}</Text>
      <Text style={styles.sectionMeta}>{meta}</Text>
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f6f8fb",
  },
  header: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.97)",
    borderBottomColor: "#e5edf7",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 12,
    paddingHorizontal: 18,
  },
  kicker: {
    color: "#2563eb",
    fontSize: 13,
    fontWeight: "900",
  },
  title: {
    color: "#111827",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 34,
  },
  trustChip: {
    alignItems: "center",
    backgroundColor: "#dbeafe",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  trustSymbol: {
    color: "#1d4ed8",
    fontSize: 16,
    fontWeight: "900",
  },
  trustText: {
    color: "#1d4ed8",
    fontSize: 13,
    fontWeight: "900",
  },
  content: {
    padding: 14,
  },
  stack: {
    gap: 14,
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderColor: "#dbe6f3",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 14,
  },
  searchSymbol: {
    color: "#111827",
    fontSize: 22,
    fontWeight: "900",
  },
  searchInput: {
    color: "#111827",
    flex: 1,
    fontSize: 16,
    minHeight: 50,
  },
  liveSummary: {
    backgroundColor: "#eaf5ff",
    borderColor: "#cfe4ff",
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 16,
  },
  liveSummaryHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionKicker: {
    color: "#2563eb",
    fontSize: 12,
    fontWeight: "900",
  },
  liveTime: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "800",
  },
  liveTitle: {
    color: "#101828",
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 27,
  },
  liveBody: {
    color: "#344054",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
  },
  quickActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 17,
    flex: 1.2,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: 12,
  },
  primaryActionText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  secondaryAction: {
    alignItems: "center",
    backgroundColor: "#ecfdf3",
    borderColor: "#b7e4cd",
    borderRadius: 17,
    borderWidth: 1,
    flex: 0.8,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: 12,
  },
  secondaryActionText: {
    color: "#047857",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  sectionTitle: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitleText: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "900",
  },
  sectionMeta: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "800",
  },
  reportList: {
    gap: 10,
  },
  reportCard: {
    alignItems: "flex-start",
    backgroundColor: "#fff",
    borderColor: "#e2e8f0",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 96,
    padding: 14,
  },
  reportBadge: {
    alignItems: "center",
    borderRadius: 13,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 52,
    paddingHorizontal: 8,
  },
  verifiedBadge: {
    backgroundColor: "#dbeafe",
  },
  unverifiedBadge: {
    backgroundColor: "#f2f4f7",
  },
  reportBadgeText: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: "900",
  },
  cardTextBlock: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  cardTitle: {
    color: "#111827",
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 21,
  },
  cardBody: {
    color: "#344054",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  cardMeta: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  regionRow: {
    gap: 8,
    paddingRight: 8,
  },
  regionChip: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderColor: "#dbe6f3",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  regionChipActive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  regionText: {
    color: "#344054",
    fontSize: 14,
    fontWeight: "900",
  },
  regionTextActive: {
    color: "#fff",
  },
  placeList: {
    gap: 10,
  },
  placeCard: {
    backgroundColor: "#fff",
    borderColor: "#e2e8f0",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 112,
    overflow: "hidden",
    padding: 14,
  },
  signalRail: {
    borderRadius: 999,
    width: 6,
  },
  placeHeaderLine: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  regionBadge: {
    backgroundColor: "#fef3c7",
    borderRadius: 999,
    color: "#92400e",
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  mapPanel: {
    backgroundColor: "#fff",
    borderColor: "#dbe6f3",
    borderRadius: 22,
    borderWidth: 1,
    gap: 7,
    padding: 16,
  },
  mapTitle: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 30,
  },
  mapBody: {
    color: "#344054",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  mapCanvas: {
    backgroundColor: "#e9f4ff",
    borderRadius: 18,
    height: 250,
    marginTop: 8,
    overflow: "hidden",
  },
  mapPin: {
    alignItems: "center",
    borderColor: "#fff",
    borderRadius: 999,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 8,
    position: "absolute",
  },
  mapPinText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderColor: "#e2e8f0",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 13,
  },
  filterChipActive: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  filterText: {
    color: "#344054",
    fontSize: 13,
    fontWeight: "900",
  },
  filterTextActive: {
    color: "#fff",
  },
  formHero: {
    backgroundColor: "#fff",
    borderColor: "#e2e8f0",
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 16,
  },
  formTitle: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29,
  },
  formBody: {
    color: "#344054",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
  },
  primaryWideButton: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 17,
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 16,
  },
  primaryWideButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },
  secondaryWideButton: {
    alignItems: "center",
    backgroundColor: "#eff6ff",
    borderRadius: 17,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  secondaryWideButtonText: {
    color: "#1d4ed8",
    fontSize: 15,
    fontWeight: "900",
  },
  choiceLabel: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },
  choiceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceChip: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderColor: "#dbe6f3",
    borderRadius: 15,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 74,
    paddingHorizontal: 12,
  },
  choiceChipActive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  choiceText: {
    color: "#344054",
    fontSize: 14,
    fontWeight: "900",
  },
  choiceTextActive: {
    color: "#fff",
  },
  memoInput: {
    backgroundColor: "#fff",
    borderColor: "#dbe6f3",
    borderRadius: 18,
    borderWidth: 1,
    color: "#111827",
    fontSize: 16,
    minHeight: 104,
    padding: 14,
    textAlignVertical: "top",
  },
  policyCard: {
    backgroundColor: "#fff8df",
    borderColor: "#f3d27b",
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  policyTitle: {
    color: "#92400e",
    fontSize: 14,
    fontWeight: "900",
  },
  policyText: {
    color: "#5f4200",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  footerCtaSpacer: {
    marginTop: 2,
  },
  ticketCard: {
    backgroundColor: "#ecfdf3",
    borderColor: "#b7e4cd",
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  ticketTitle: {
    color: "#047857",
    fontSize: 16,
    fontWeight: "900",
  },
  ticketText: {
    color: "#344054",
    fontSize: 13,
    fontWeight: "800",
  },
  exampleWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  exampleChip: {
    alignItems: "center",
    backgroundColor: "#dbeafe",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  exampleText: {
    color: "#1d4ed8",
    fontSize: 13,
    fontWeight: "900",
  },
  disabledButton: {
    opacity: 0.45,
  },
  profileCard: {
    backgroundColor: "#111827",
    borderRadius: 22,
    gap: 7,
    padding: 18,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statCard: {
    backgroundColor: "#fff",
    borderColor: "#e2e8f0",
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: 6,
    minHeight: 92,
    padding: 14,
  },
  statLabel: {
    color: "#667085",
    fontSize: 13,
    fontWeight: "900",
  },
  statValue: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "900",
  },
  bottomNav: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderColor: "#dbe6f3",
    borderRadius: 24,
    borderWidth: 1,
    bottom: 10,
    flexDirection: "row",
    gap: 4,
    left: 12,
    padding: 8,
    position: "absolute",
    right: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  navButton: {
    alignItems: "center",
    borderRadius: 18,
    flex: 1,
    gap: 3,
    justifyContent: "center",
    minHeight: 54,
  },
  navButtonActive: {
    backgroundColor: "#dbeafe",
  },
  navSymbol: {
    color: "#667085",
    fontSize: 18,
    fontWeight: "900",
  },
  navLabel: {
    color: "#667085",
    fontSize: 11,
    fontWeight: "900",
  },
  navTextActive: {
    color: "#1d4ed8",
  },
});
