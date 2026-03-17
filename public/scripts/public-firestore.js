(function () {
  function decodeValue(value) {
    if (!value || typeof value !== "object") return null;
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return Number(value.doubleValue);
    if ("booleanValue" in value) return Boolean(value.booleanValue);
    if ("timestampValue" in value) return value.timestampValue;
    if ("nullValue" in value) return null;
    if ("mapValue" in value) {
      return decodeFields(value.mapValue.fields || {});
    }
    if ("arrayValue" in value) {
      return (value.arrayValue.values || []).map(decodeValue);
    }
    return null;
  }

  function decodeFields(fields) {
    return Object.fromEntries(
      Object.entries(fields || {}).map(function (entry) {
        return [entry[0], decodeValue(entry[1])];
      })
    );
  }

  function decodeDocument(document) {
    if (!document) return null;
    var name = String(document.name || "");
    var id = name.split("/").pop() || "";
    return Object.assign({ id: id }, decodeFields(document.fields || {}));
  }

  function buildBaseUrl(config, path) {
    return "https://firestore.googleapis.com/v1/projects/" +
      encodeURIComponent(config.projectId) +
      "/databases/(default)/documents/" +
      path;
  }

  async function requestJson(url) {
    var response = await fetch(url, { method: "GET", cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error("Firestore request failed: " + response.status);
    }
    return response.json();
  }

  async function getDocument(config, path) {
    if (!config || !config.projectId || !config.apiKey) return null;
    var url = buildBaseUrl(config, path) + "?key=" + encodeURIComponent(config.apiKey);
    var payload = await requestJson(url);
    return payload ? decodeDocument(payload) : null;
  }

  async function listCollection(config, collectionId) {
    if (!config || !config.projectId || !config.apiKey) return [];
    var url = buildBaseUrl(config, collectionId) + "?pageSize=200&key=" + encodeURIComponent(config.apiKey);
    var payload = await requestJson(url);
    if (!payload || !Array.isArray(payload.documents)) return [];
    return payload.documents.map(decodeDocument).filter(Boolean);
  }

  window.SFAPublicFirestore = {
    getDocument: getDocument,
    listCollection: listCollection,
  };
})();
