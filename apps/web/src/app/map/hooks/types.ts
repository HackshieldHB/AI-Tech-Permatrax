import type { FeatureCollection } from 'geojson'; // FIX

export interface ClusterPin {
  id: string; // FIX
  clusterCode: string; // FIX
  ispCustomer: string; // FIX
  fiberType: string; // FIX
  phase: string; // FIX
  status: string; // FIX
  latitude: number | null; // FIX
  longitude: number | null; // FIX
  rwName: string | null; // FIX
  areaCategory: string | null; // FIX
  siteName: string | null; // FIX
  isDone: boolean; // FIX
  homepasCount: number; // FIX
  doneAt?: string | null; // FIX
}

export interface GisLayer {
  id: string; // FIX
  name: string; // FIX
  geoJson: FeatureCollection; // FIX
  color: string; // FIX
  isVisible: boolean; // FIX
  // GIS Issue 5: gunakan titik (Point) layer KMZ ini sebagai titik pelanggan
  // (homepass) pada kalkulasi topologi — menggantikan bangunan OSM
  useAsCustomers?: boolean;
  /** JLM hybrid: treat ODP/ODC/OLT/cables in this KMZ as existing infrastructure */
  useAsExistingNetwork?: boolean;
}

export interface NominatimResult {
  display_name: string; // FIX
  lat: string; // FIX
  lon: string; // FIX
  type?: string; // FIX
  class?: string; // FIX
}

export type OsmElement = { tags?: Record<string, string> }; // FIX: Overpass element shape

export type TopoExportData = {
  backbone?: [number, number]; // FIX
  odcPoint?: [number, number]; // FIX
  odpPositions?: [number, number][]; // FIX
  // JLM Issue 1/2: homepass enriched with ODP assignment + coverage status for KMZ + Excel export
  homepassPoints?: Array<{
    lng: number;
    lat: number;
    isOsm: boolean;
    odpIndex?: number; // 1-based ODP serving this homepass (undefined when uncovered)
    covered?: boolean; // Tercover (served by an ODP within coverage) vs Tidak Tercover
  }>; // FIX
  // JLM Issue 2: cable geometry so KMZ shows the actual network paths in Google Earth
  feederCoords?: [number, number][]; // OLT → ODC
  distRoutes?: [number, number][][]; // ODC → ODP cascade segments
  closurePoints?: [number, number][]; // splice closures along feeder
  polePoints?: [number, number][]; // JLM Issue B: auto-generated poles at configurable interval
  // JLM Issue 3A: per-ODP port utilization (load / capacity)
  odpLoad?: number[]; // homepass count per ODP (index-aligned with odpPositions)
  odpCapacity?: number; // 8 or 16 — selected/derived port capacity
  /** GIS Issue 4 / JLM Extra C: count of distribution segments that fell back to straight line */
  straightRouteCount?: number;
  /** Locked existing ODPs (from KMZ / manual) that were not regenerated */
  existingOdpCount?: number;
  /** JLM Homepass coverage: served/unserved + reason codes after Kalkulasi AI */
  coverageReport?: {
    totalHomepass: number;
    covered: number;
    unserved: number;
    reasons: { CAPACITY: number; DISTANCE: number; NO_ODP: number };
    odpPlaced: number;
    odpTarget: number;
    odpAddedForCoverage: number;
  };
}; // FIX

// FIX: shape of POST /map/calculate response (enhanced FTTH topology)
export type FtthCalcApiResponse = {
  summary: {
    areaCategory: 'A' | 'B' | 'C'; // FIX
    categoryReason: string; // FIX
    backboneOwner: string; // FIX
    backboneDistanceM: number; // FIX
    areaType: string; // FIX
    areaRadiusMeters?: number; // FIX
    coverageRadiusMeters?: number; // FIX: equiv. radius for topology (polygon)
    polygonAreaSqM?: number; // FIX
    polygonCentroidLat?: number; // FIX
    polygonCentroidLon?: number; // FIX
  }; // FIX
  roi?: {
    tiers: Array<{
      name: string; // FIX
      arpu: number; // FIX
      takeRatePct: number; // FIX
      activeHomepass: number; // FIX
      monthlyRevenue: number; // FIX
      annualRevenue: number; // FIX
      breakEvenMonths: number; // FIX
      breakEvenYears: number; // FIX
      color: string; // FIX
      isViable: boolean; // FIX
    }>; // FIX
    totalTakeRatePct: number; // FIX
    totalActiveHomepass: number; // FIX
    totalMonthlyRevenue: number; // FIX
    totalAnnualRevenue: number; // FIX
    overallBepMonths: number; // FIX
    overallBepYears: number; // FIX
    currency: string; // FIX
  }; // FIX
  homepass: { estimated: number; active: number; takeRatePercent: number }; // FIX
  homepassPoints?: Array<{ coords: [number, number]; odpIdx: number; id?: string }>; // FIX: preserve actual homepass coordinates across recalculations
  route: { totalM: number; feederM: number; distributionM: number }; // FIX
  cable: {
    totalM: number; // FIX
    feederCableType: string; // FIX
    distCableType: string; // FIX
    dropCableType: string; // FIX
    installMethod: string; // FIX
    installReason: string; // FIX
    breakdown: {
      feederM: number; // FIX
      distributionM: number; // FIX
      dropM: number; // FIX
      bufferPercent: number; // FIX
    }; // FIX
  }; // FIX
  equipment: {
    olt: { recommendation: string; portsNeeded: number; standard: string }; // FIX
    odc: { count: number; capacity: string; unit: string }; // FIX
    odp: { count: number; capacity: number; spacingM: number; unit: string }; // FIX
    splitter: { count: number; ratio: string; unit: string }; // FIX
    closure: { inline: number; total: number; unit: string }; // FIX
    pole: {
      total: number; // FIX
      existing: number; // FIX
      newBuild: number; // FIX
      spacingM: number; // FIX
      unit: string; // FIX
      note: string; // FIX
    }; // FIX
    splice: { total: number; plan: unknown[]; unit: string }; // FIX
    connector: { count: number; type: string; unit: string }; // FIX
    patchCord: { count: number; type: string; unit: string }; // FIX
    ont: { count: number; type: string; unit: string }; // FIX
    jointBox: { count: number; unit: string }; // FIX
    hdpeConduit: { meters: number; type: string; unit: string }; // FIX
  }; // FIX
  topology: {
    description: string; // FIX
    segments: Array<{
      name: string; // FIX
      from: string; // FIX
      to: string; // FIX
      distance: string; // FIX
      cable: string; // FIX
      notes?: string; // FIX
    }>; // FIX
    standards: string[]; // FIX
    selected?: {
      // FIX: auto-selected topology from API
      type: string; // FIX
      label: string; // FIX
      description: string; // FIX
      pros: string[]; // FIX
      cons: string[]; // FIX
      suitability: number; // FIX
    }; // FIX
  }; // FIX
  powerBudget: {
    gponClass: string; // FIX
    linkMarginDB: number; // FIX
    isOk: boolean; // FIX
    totalLossDB: number; // FIX
    breakdown: {
      splitterDB: number; // FIX
      seratFeederDB: number; // FIX
      konektorDB: number; // FIX
      sambunganDB: number; // FIX
      seratDistDB: number; // FIX
      seratDropDB: number; // FIX
    }; // FIX
  }; // FIX
  costEstimation: {
    currency: string; // FIX
    note: string; // FIX
    breakdown: Array<{ item: string; qty: string; idr: number }>; // FIX
    totalMaterial: number; // FIX
    totalInstall: number; // FIX
    totalProject: number; // FIX
    costPerHomepass: number; // FIX
    roi: {
      revenuePerHpPerMonth: number; // FIX
      monthlyRevenue: number; // FIX
      breakEvenMonths: number; // FIX
      tiers?: Array<{
        name: string; // FIX
        arpu: number; // FIX
        takeRatePct: number; // FIX
        activeHomepass: number; // FIX
        monthlyRevenue: number; // FIX
        breakEvenMonths: number; // FIX
        isViable: boolean; // FIX
        color: string; // FIX
      }>; // FIX
    }; // FIX
  }; // FIX
  installation: {
    method: string; // FIX
    totalDuration: string; // FIX
    sequence: Array<{
      step: number; // FIX
      title: string; // FIX
      tasks: string[]; // FIX
      duration: string; // FIX
    }>; // FIX
  }; // FIX
  recommendations: Array<{
    icon: string; // FIX
    title: string; // FIX
    detail: string; // FIX
    severity: 'info' | 'success' | 'warning' | 'error'; // FIX
  }>; // FIX
}; // FIX
