"""SigLIP embedding pipeline (lazy-loaded, GPU/CPU)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np

from cinearchive.config import Settings, get_settings
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


def _as_tensor(feats: Any) -> Any:
    """Normalize transformers outputs to a 2D embedding tensor."""
    if feats is None:
        raise RuntimeError("Empty embedding output")
    # ModelOutput / BaseModelOutputWithPooling
    if hasattr(feats, "pooler_output") and feats.pooler_output is not None:
        return feats.pooler_output
    if hasattr(feats, "image_embeds") and feats.image_embeds is not None:
        return feats.image_embeds
    if hasattr(feats, "text_embeds") and feats.text_embeds is not None:
        return feats.text_embeds
    if hasattr(feats, "last_hidden_state") and feats.last_hidden_state is not None:
        # CLS / first token
        return feats.last_hidden_state[:, 0]
    if isinstance(feats, (tuple, list)):
        return _as_tensor(feats[0])
    if hasattr(feats, "detach"):
        return feats
    raise RuntimeError(f"Unsupported embedding type: {type(feats)}")


class EmbeddingPipeline:
    """Lazy SigLIP image/text embedder with batch support."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._model: Any = None
        self._processor: Any = None
        self._torch: Any = None
        self._device: str | None = None
        self._ready = False

    @property
    def is_ready(self) -> bool:
        return self._ready

    def _resolve_device(self) -> str:
        if self.settings.device == "cpu":
            return "cpu"
        if self.settings.device == "cuda":
            return "cuda"
        try:
            import torch

            return "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            return "cpu"

    def load(self) -> None:
        if self._model is not None:
            return
        os.environ.setdefault("HF_HOME", self.settings.hf_home)
        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        Path(self.settings.hf_home).mkdir(parents=True, exist_ok=True)

        import torch
        from transformers import AutoModel, AutoProcessor

        self._torch = torch
        self._device = self._resolve_device()
        model_id = self.settings.embedding_model
        logger.info("Loading embedding model %s on %s", model_id, self._device)

        self._processor = AutoProcessor.from_pretrained(model_id, cache_dir=self.settings.hf_home)
        self._model = AutoModel.from_pretrained(model_id, cache_dir=self.settings.hf_home)
        self._model.eval()
        self._model.to(self._device)
        self._ready = True
        logger.info("Embedding model ready")

    def warmup(self) -> None:
        self.load()

    def _normalize(self, vectors: np.ndarray) -> list[list[float]]:
        if vectors.ndim == 1:
            vectors = vectors.reshape(1, -1)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        norms = np.maximum(norms, 1e-12)
        return (vectors / norms).astype(np.float32).tolist()

    def embed_images(self, image_paths: list[Path]) -> list[list[float]]:
        if not image_paths:
            return []
        self.load()
        assert self._model is not None and self._processor is not None and self._torch is not None

        from PIL import Image

        batch_size = max(1, self.settings.embedding_batch_size)
        all_vectors: list[list[float]] = []

        for i in range(0, len(image_paths), batch_size):
            batch_paths = image_paths[i : i + batch_size]
            images = []
            for p in batch_paths:
                with Image.open(p) as img:
                    images.append(img.convert("RGB"))

            inputs = self._processor(images=images, return_tensors="pt", padding=True)
            pixel_values = inputs["pixel_values"].to(self._device)

            with self._torch.no_grad():
                if hasattr(self._model, "get_image_features"):
                    feats = self._model.get_image_features(pixel_values=pixel_values)
                else:
                    outputs = self._model(pixel_values=pixel_values)
                    feats = outputs

            tensor = _as_tensor(feats)
            vecs = tensor.detach().cpu().float().numpy()
            all_vectors.extend(self._normalize(vecs))

        return all_vectors

    def embed_text(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        self.load()
        assert self._model is not None and self._processor is not None and self._torch is not None

        inputs = self._processor(
            text=texts, return_tensors="pt", padding=True, truncation=True, max_length=64
        )
        input_ids = inputs["input_ids"].to(self._device)
        attention_mask = inputs.get("attention_mask")
        if attention_mask is not None:
            attention_mask = attention_mask.to(self._device)

        with self._torch.no_grad():
            if hasattr(self._model, "get_text_features"):
                kwargs = {"input_ids": input_ids}
                if attention_mask is not None:
                    kwargs["attention_mask"] = attention_mask
                feats = self._model.get_text_features(**kwargs)
            else:
                kwargs = {"input_ids": input_ids}
                if attention_mask is not None:
                    kwargs["attention_mask"] = attention_mask
                feats = self._model(**kwargs)

        tensor = _as_tensor(feats)
        vecs = tensor.detach().cpu().float().numpy()
        return self._normalize(vecs)


# Process-wide singleton for BackgroundTasks
_embedding_singleton: EmbeddingPipeline | None = None


def get_embedding_pipeline(settings: Settings | None = None) -> EmbeddingPipeline:
    global _embedding_singleton
    if _embedding_singleton is None:
        _embedding_singleton = EmbeddingPipeline(settings)
    return _embedding_singleton


def reset_embedding_pipeline() -> None:
    global _embedding_singleton
    _embedding_singleton = None
