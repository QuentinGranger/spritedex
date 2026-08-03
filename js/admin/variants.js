(() => {
  "use strict";

  function openVariantEditor(button) {
    let variant = {};
    try {
      variant = JSON.parse(button.dataset.variantJson || "{}");
    } catch (_) {
      /* legacy buttons remain editable */
    }
    state.variantEditor = { id: button.dataset.editVariant, variant };
    $("#variantEditorTitle").textContent = english ? "Edit variant" : "Modifier la variante";
    $("#variantEditorSummary").textContent = button.dataset.variantName || button.dataset.editVariant;
    $("#variantEditorName").value = button.dataset.variantName || "";
    $("#variantEditorRarity").value = button.dataset.variantRarity || "";
    $("#variantEditorReleaseStatus").value = button.dataset.variantRelease || "";
    $("#variantEditorDataStatus").value = button.dataset.variantStatus || "unknown";
    $("#variantEditorImagePath").value = button.dataset.variantImage || "";
    $("#variantEditorOfficialName").value = variant.official_name || "";
    $("#variantEditorSlug").value = variant.slug || "";
    $("#variantEditorSuggestedImagePath").value = variant.suggested_image_path || "";
    $("#variantEditorFirstObservedAt").value = toLocalInput(variant.first_observed_at);
    $("#variantEditorSummonCost").value = variant.summon_cost ?? "";
    $("#variantEditorDropChance").value = variant.sprite_chest_drop_chance_pct ?? "";
    $("#variantEditorExtraEffectRef").value = variant.extra_effect_ref || "";
    [
      ["#variantEditorEffect", variant.effect],
      ["#variantEditorAcquisition", variant.acquisition],
      ["#variantEditorAvailability", variant.availability],
      ["#variantEditorRecurrence", variant.recurrence],
      ["#variantEditorDates", variant.dates],
      ["#variantEditorMissingFields", variant.missing_fields],
      ["#variantEditorSources", variant.sources]
    ].forEach(([id, value]) => {
      $(id).value = value == null ? "" : JSON.stringify(value, null, 2);
    });
    $("#variantEditorReason").value = "";
    $("#variantEditorError").hidden = true;
    $("#variantEditorDialog").showModal();
    $("#variantEditorName").focus();
  }

  async function submitVariantEditor(event) {
    event.preventDefault();
    const operation = state.variantEditor;
    if (!operation?.id) return;
    const errorNode = $("#variantEditorError");
    const reasonValue = $("#variantEditorReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    errorNode.hidden = true;
    const submit = $("#variantEditorSubmit");
    submit.disabled = true;
    try {
      await adminFetch(`/api/admin/catalog/variants/${encodeURIComponent(operation.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: Object.fromEntries(new FormData($("#variantEditorForm"))),
          reason: reasonValue
        })
      });
      closeEditorialDialog("#variantEditorDialog");
      setNotice(english ? "Variant updated." : "Variante mise à jour.");
      if (state.catalog.selected) await selectCatalog(state.catalog.selected);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openAvailabilityEditor(button) {
    state.availabilityEditor = { spriteId: button.dataset.spriteId };
    $("#availabilityEditorTitle").textContent = english ? "Add availability" : "Ajouter une disponibilité";
    $("#availabilityEditorSummary").textContent = button.dataset.spriteName || button.dataset.spriteId || "";
    $("#availabilityEditorStatus").value = "available";
    $("#availabilityEditorConfidence").value = "medium";
    $("#availabilityEditorStartDate").value = "";
    $("#availabilityEditorEndDate").value = "";
    $("#availabilityEditorEventId").value = "";
    $("#availabilityEditorDataStatus").value = "incomplete";
    $("#availabilityEditorReason").value = "";
    $("#availabilityEditorError").hidden = true;
    $("#availabilityEditorDialog").showModal();
    $("#availabilityEditorStatus").focus();
  }

  async function submitAvailabilityEditor(event) {
    event.preventDefault();
    const operation = state.availabilityEditor;
    if (!operation?.spriteId) return;
    const errorNode = $("#availabilityEditorError");
    const reasonValue = $("#availabilityEditorReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    errorNode.hidden = true;
    const submit = $("#availabilityEditorSubmit");
    submit.disabled = true;
    try {
      await adminFetch(`/api/admin/catalog/${encodeURIComponent(operation.spriteId)}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: $("#availabilityEditorStatus").value,
          confidence: $("#availabilityEditorConfidence").value,
          startDate: $("#availabilityEditorStartDate").value || "",
          endDate: $("#availabilityEditorEndDate").value || "",
          eventId: $("#availabilityEditorEventId").value.trim() || null,
          dataStatus: $("#availabilityEditorDataStatus").value,
          reason: reasonValue
        })
      });
      closeEditorialDialog("#availabilityEditorDialog");
      setNotice(english ? "Availability period added." : "Période de disponibilité ajoutée.");
      await selectCatalog(operation.spriteId);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  Object.assign(window, { openVariantEditor, submitVariantEditor, openAvailabilityEditor, submitAvailabilityEditor });
})();
