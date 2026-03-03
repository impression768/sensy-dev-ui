import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
const ITEMS_QUERY_KEY = ["items"];
const INSIGHTS_HISTORY_QUERY_KEY = ["mind-cloud-insights", "history"];
const INSIGHT_DETAIL_QUERY_KEY = ["mind-cloud-insights", "detail"];

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[exponent]}`;
};

const formatDateTime = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
};

const parseErrorMessage = async (response) => {
  try {
    const data = await response.json();
    if (typeof data?.message === "string" && data.message.trim()) {
      return data.message;
    }
  } catch {
    // Ignore invalid error payloads and use status fallback.
  }
  return `Request failed (${response.status})`;
};

const requestJson = async (path, init = {}) => {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
};

const fetchItems = async () => {
  const data = await requestJson("/api/items?limit=50");
  return Array.isArray(data) ? data : [];
};

const fetchMindCloudInsightHistory = async () => {
  const data = await requestJson("/api/insights?limit=100");
  return Array.isArray(data) ? data : [];
};

const fetchMindCloudInsightById = async (insightId) => {
  if (!insightId) {
    return null;
  }
  return requestJson(`/api/insights/${insightId}`);
};

const generateMindCloudInsight = async () =>
  requestJson("/api/insights/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

const submitPayload = async ({ text, files }) => {
  const normalizedText = String(text || "").trim();
  if (!normalizedText && files.length === 0) {
    throw new Error("Enter text and/or upload at least one image.");
  }

  const images = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mimeType: file.type,
      size: file.size,
      dataUrl: await fileToDataUrl(file)
    }))
  );

  return requestJson("/api/items/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: normalizedText || undefined,
      images
    })
  });
};

function App() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [formError, setFormError] = useState("");
  const [insightError, setInsightError] = useState("");
  const [selectedInsightId, setSelectedInsightId] = useState(null);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const selectedTotalSize = useMemo(
    () => files.reduce((sum, file) => sum + (file.size || 0), 0),
    [files]
  );

  const itemsQuery = useQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchItems
  });

  const insightsHistoryQuery = useQuery({
    queryKey: INSIGHTS_HISTORY_QUERY_KEY,
    queryFn: fetchMindCloudInsightHistory
  });

  const insightsHistory = useMemo(
    () => (Array.isArray(insightsHistoryQuery.data) ? insightsHistoryQuery.data : []),
    [insightsHistoryQuery.data]
  );

  const resolvedSelectedInsightId = useMemo(() => {
    if (insightsHistory.length === 0) {
      return null;
    }

    if (!selectedInsightId) {
      return insightsHistory[0]._id;
    }

    const exists = insightsHistory.some((insight) => insight?._id === selectedInsightId);
    return exists ? selectedInsightId : insightsHistory[0]._id;
  }, [insightsHistory, selectedInsightId]);

  const selectedInsightQuery = useQuery({
    queryKey: [...INSIGHT_DETAIL_QUERY_KEY, resolvedSelectedInsightId],
    queryFn: () => fetchMindCloudInsightById(resolvedSelectedInsightId),
    enabled: Boolean(resolvedSelectedInsightId)
  });

  const submitMutation = useMutation({
    mutationFn: submitPayload,
    onSuccess: async (data) => {
      setFormError("");
      setText("");
      setFiles([]);
      setFileInputKey((current) => current + 1);

      await queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });

      const newestCreatedItemId = data?.items?.[0]?._id;
      if (newestCreatedItemId) {
        setSelectedItemId(newestCreatedItemId);
        setIsDetailOpen(true);
      }
    },
    onError: (error) => {
      setFormError(error?.message || "Submission failed");
    }
  });

  const generateInsightMutation = useMutation({
    mutationFn: generateMindCloudInsight,
    onSuccess: async (insight) => {
      setInsightError("");

      if (insight?._id) {
        setSelectedInsightId(insight._id);
        queryClient.setQueryData([...INSIGHT_DETAIL_QUERY_KEY, insight._id], insight);
      }

      await queryClient.invalidateQueries({ queryKey: INSIGHTS_HISTORY_QUERY_KEY });
    },
    onError: (error) => {
      setInsightError(error?.message || "Failed to generate mind cloud insights");
    }
  });

  const items = useMemo(
    () => (Array.isArray(itemsQuery.data) ? itemsQuery.data : []),
    [itemsQuery.data]
  );

  const latestInsightMeta = insightsHistory[0] || null;
  const selectedInsight = selectedInsightQuery.data || null;

  const selectedItem = useMemo(
    () => {
      if (items.length === 0) {
        return null;
      }
      if (!selectedItemId) {
        return items[0];
      }
      return items.find((item) => item?._id === selectedItemId) || items[0];
    },
    [items, selectedItemId]
  );

  const isDrawerOpen = isDetailOpen && Boolean(selectedItem);

  const onFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    const imageFiles = selectedFiles.filter((file) =>
      String(file?.type || "").toLowerCase().startsWith("image/")
    );
    const rejectedCount = selectedFiles.length - imageFiles.length;

    if (rejectedCount > 0) {
      setFormError(`${rejectedCount} file(s) were ignored because only image uploads are allowed.`);
    } else if (!submitMutation.isError) {
      setFormError("");
    }

    setFiles(imageFiles);
  };

  const onSubmit = (event) => {
    event.preventDefault();
    setFormError("");
    submitMutation.mutate({ text, files });
  };

  const onCardClick = (itemId) => {
    setSelectedItemId(itemId);
    setIsDetailOpen(true);
  };

  const onSelectInsight = (event) => {
    setSelectedInsightId(event.target.value || null);
  };

  const onGenerateInsight = () => {
    setInsightError("");
    generateInsightMutation.mutate();
  };

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Mind Cloud Insights</h1>
              <p className="mt-1 text-sm text-slate-600">
                Connect dots across all items and surface non-obvious patterns.
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-[320px]">
              <button
                type="button"
                onClick={onGenerateInsight}
                disabled={generateInsightMutation.isPending}
                className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generateInsightMutation.isPending ? "Generating..." : "Generate Insights"}
              </button>

              <select
                value={resolvedSelectedInsightId || ""}
                onChange={onSelectInsight}
                disabled={insightsHistory.length === 0}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                {insightsHistory.length === 0 && <option value="">No previous snapshots</option>}
                {insightsHistory.map((insight) => (
                  <option key={insight._id} value={insight._id}>
                    {`${formatDateTime(insight.generatedAt)} | ${insight.small?.title || "Untitled"} (${insight.itemCount || 0} items)`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {insightError && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {insightError}
            </div>
          )}

          {generateInsightMutation.isSuccess && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Insight snapshot generated and saved.
            </div>
          )}

          {insightsHistoryQuery.isLoading && (
            <p className="mt-4 text-sm text-slate-600">Loading insight history...</p>
          )}

          {insightsHistoryQuery.isError && (
            <p className="mt-4 text-sm text-rose-600">
              {insightsHistoryQuery.error?.message || "Failed to load insights"}
            </p>
          )}

          {!insightsHistoryQuery.isLoading &&
            !insightsHistoryQuery.isError &&
            insightsHistory.length === 0 && (
              <p className="mt-4 text-sm text-slate-600">
                No insight snapshots yet. Generate the first one.
              </p>
            )}

          {!insightsHistoryQuery.isLoading && !insightsHistoryQuery.isError && insightsHistory.length > 0 && (
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {latestInsightMeta?._id === resolvedSelectedInsightId
                  ? "Latest Snapshot"
                  : "Selected Snapshot"}
              </p>

              {selectedInsightQuery.isLoading && (
                <p className="mt-2 text-sm text-slate-600">Loading selected insight...</p>
              )}

              {selectedInsightQuery.isError && (
                <p className="mt-2 text-sm text-rose-600">
                  {selectedInsightQuery.error?.message || "Failed to load selected insight"}
                </p>
              )}

              {selectedInsight && (
                <>
                  <h2 className="mt-2 text-xl font-semibold text-slate-900">
                    {selectedInsight.small?.title || "Mind Cloud Insight"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-700">
                    {selectedInsight.small?.summary || "No summary"}
                  </p>

                  <dl className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                    <div className="rounded bg-white p-2">
                      <dt className="font-semibold text-slate-500">Generated</dt>
                      <dd className="mt-1">{formatDateTime(selectedInsight.generatedAt)}</dd>
                    </div>
                    <div className="rounded bg-white p-2">
                      <dt className="font-semibold text-slate-500">Items Used</dt>
                      <dd className="mt-1">{selectedInsight.itemCount || 0}</dd>
                    </div>
                  </dl>

                  <section className="mt-4">
                    <h3 className="text-sm font-semibold text-slate-900">Overall Sense</h3>
                    <p className="mt-1 text-sm text-slate-700">
                      {selectedInsight.insight?.overallSense || "-"}
                    </p>
                  </section>

                  <section className="mt-4">
                    <h3 className="text-sm font-semibold text-slate-900">Insight Clusters</h3>
                    {(selectedInsight.insight?.clusters || []).length === 0 && (
                      <p className="mt-1 text-sm text-slate-600">No clusters provided.</p>
                    )}
                    {(selectedInsight.insight?.clusters || []).map((cluster, index) => (
                      <div key={`${cluster.theme}-${index}`} className="mt-2 rounded bg-white p-3">
                        <p className="text-sm font-medium text-slate-900">{cluster.theme}</p>
                        <p className="mt-1 text-xs text-slate-600">{cluster.essence}</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                          {(cluster.bullets || []).map((bullet, bulletIndex) => (
                            <li key={`${bulletIndex}-${bullet}`}>{bullet}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>

                  <section className="mt-4">
                    <h3 className="text-sm font-semibold text-slate-900">Hidden Connections</h3>
                    {(selectedInsight.insight?.hiddenConnections || []).length === 0 && (
                      <p className="mt-1 text-sm text-slate-600">No hidden connections provided.</p>
                    )}
                    {(selectedInsight.insight?.hiddenConnections || []).map((connection, index) => (
                      <div key={`${connection.connection}-${index}`} className="mt-2 rounded bg-white p-3">
                        <p className="text-sm font-medium text-slate-900">{connection.connection}</p>
                        <p className="mt-1 text-xs text-slate-600">{connection.whyNonObvious}</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                          {(connection.evidence || []).map((signal, signalIndex) => (
                            <li key={`${signalIndex}-${signal}`}>{signal}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>

                  <section className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded bg-white p-3">
                      <h3 className="text-sm font-semibold text-slate-900">Recommended Now</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                        {(selectedInsight.insight?.recommendedActions?.immediate || []).map(
                          (entry, index) => (
                            <li key={`${index}-${entry}`}>{entry}</li>
                          )
                        )}
                      </ul>
                    </div>

                    <div className="rounded bg-white p-3">
                      <h3 className="text-sm font-semibold text-slate-900">Recommended Next</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                        {(selectedInsight.insight?.recommendedActions?.nextWave || []).map(
                          (entry, index) => (
                            <li key={`${index}-${entry}`}>{entry}</li>
                          )
                        )}
                      </ul>
                    </div>
                  </section>

                  <section className="mt-4 rounded bg-white p-3">
                    <h3 className="text-sm font-semibold text-slate-900">Open Questions</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                      {(selectedInsight.insight?.openQuestions || []).map((question, index) => (
                        <li key={`${index}-${question}`}>{question}</li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold text-slate-900">Sensy Item Ingestion</h1>

          <form className="mt-6" onSubmit={onSubmit}>
            <div>
              <label htmlFor="images" className="mb-2 block text-sm font-medium text-slate-700">
                Images (multiple)
              </label>
              <input
                key={fileInputKey}
                id="images"
                type="file"
                accept="image/*"
                multiple
                onChange={onFileChange}
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
              />
              <p className="mt-2 text-xs text-slate-500">
                Selected: {files.length} image(s), total {formatBytes(selectedTotalSize)}
              </p>
            </div>

            <div className="mt-5">
              <label htmlFor="text" className="mb-2 block text-sm font-medium text-slate-700">
                Text
              </label>
              <textarea
                id="text"
                rows="7"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Write your text here..."
                className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-500"
              />
            </div>

            <button
              type="submit"
              disabled={submitMutation.isPending}
              className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitMutation.isPending ? "Processing..." : "Submit Payload"}
            </button>
          </form>

          {formError && (
            <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {formError}
            </div>
          )}

          {submitMutation.isSuccess && (
            <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Payload processed. List was refreshed from DB.
            </div>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Items From DB</h2>
            {itemsQuery.isFetching && (
              <span className="text-xs font-medium text-slate-500">Refreshing...</span>
            )}
          </div>

          {itemsQuery.isLoading && <p className="mt-4 text-sm text-slate-600">Loading items...</p>}

          {itemsQuery.isError && (
            <p className="mt-4 text-sm text-rose-600">
              {itemsQuery.error?.message || "Failed to load items"}
            </p>
          )}

          {!itemsQuery.isLoading && !itemsQuery.isError && items.length === 0 && (
            <p className="mt-4 text-sm text-slate-600">No items found yet.</p>
          )}

          {!itemsQuery.isLoading && !itemsQuery.isError && items.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {items.map((item) => {
                const isActive = item?._id === selectedItemId;
                return (
                  <button
                    key={item._id}
                    type="button"
                    onClick={() => onCardClick(item._id)}
                    className={`rounded-lg border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{item?.small?.title || "Untitled item"}</p>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          isActive ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {item?.type || "-"}
                      </span>
                    </div>
                    <p
                      className={`mt-1 text-xs ${
                        isActive ? "text-slate-200" : "text-slate-600"
                      }`}
                    >
                      {item?.small?.summary || "No summary"}
                    </p>
                    <p className={`mt-2 text-[11px] ${isActive ? "text-slate-300" : "text-slate-500"}`}>
                      {formatDateTime(item?.createdAt)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div
        onClick={() => setIsDetailOpen(false)}
        className={`fixed inset-0 z-30 bg-slate-900/30 transition-opacity ${
          isDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed right-0 top-0 z-40 h-screen w-full max-w-xl border-l border-slate-200 bg-white shadow-xl transition-transform duration-300 ${
          isDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Item Details</p>
            <h3 className="mt-1 text-base font-semibold text-slate-900">
              {selectedItem?.small?.title || "No item selected"}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setIsDetailOpen(false)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </header>

        <div className="h-[calc(100vh-89px)] overflow-y-auto p-5">
          {!selectedItem && <p className="text-sm text-slate-600">Select a card to view details.</p>}

          {selectedItem && (
            <>
              <p className="text-sm text-slate-700">{selectedItem?.small?.summary || "No summary"}</p>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-700">
                <div className="rounded bg-slate-100 p-2">
                  <dt className="font-semibold text-slate-500">Type</dt>
                  <dd className="mt-1">{selectedItem.type || "-"}</dd>
                </div>
                <div className="rounded bg-slate-100 p-2">
                  <dt className="font-semibold text-slate-500">Created</dt>
                  <dd className="mt-1">{formatDateTime(selectedItem.createdAt)}</dd>
                </div>
                <div className="rounded bg-slate-100 p-2">
                  <dt className="font-semibold text-slate-500">Ingestion ID</dt>
                  <dd className="mt-1 break-all">{selectedItem.ingestionId || "-"}</dd>
                </div>
                <div className="rounded bg-slate-100 p-2">
                  <dt className="font-semibold text-slate-500">Source Index</dt>
                  <dd className="mt-1">
                    {Number.isInteger(selectedItem.sourceIndex) ? selectedItem.sourceIndex : "-"}
                  </dd>
                </div>
              </dl>

              <section className="mt-4">
                <h4 className="mb-2 text-sm font-semibold text-slate-900">Detailed Data</h4>
                <pre className="overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(selectedItem.detailed ?? {}, null, 2)}
                </pre>
              </section>

              <details className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-800">
                  Full Record JSON
                </summary>
                <pre className="mt-3 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(selectedItem, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>
      </aside>
    </main>
  );
}

export default App;
