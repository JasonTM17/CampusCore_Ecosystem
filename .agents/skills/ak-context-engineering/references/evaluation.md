# Evaluation

Systematically assess agent performance and context engineering choices.

## Evidence qualification (applies to the retained figures)

The variance split and resulting token-versus-model implication below are
unverified historical claims without a pinned dataset or source. Do not use
them as measured facts or as a decision rule. Hold tasks, scoring, permissions
and environment constant in matched runs; record actual outcome, tokens, tool
calls and duration. Compare cost only after correctness and authority gates
pass. Unavailable measurements are NOT_RUN. Rubric weights below are
illustrative: select them before running the evaluation.

## Key Finding: 95% Performance Variance

- **Token usage**: 80% of variance
- **Tool calls**: ~10% of variance
- **Model choice**: ~5% of variance

**Implication**: Token budgets matter more than model upgrades.

## Multi-Dimensional Rubric

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Factual Accuracy | 30% | Ground truth verification |
| Completeness | 25% | Coverage of requirements |
| Tool Efficiency | 20% | Appropriate tool usage |
| Citation Accuracy | 15% | Sources match claims |
| Source Quality | 10% | Authority/credibility |

## Evaluation Methods

### LLM-as-Judge

Beware biases:
- **Position**: First position preferred
- **Length**: Longer = higher score
- **Self-enhancement**: Rating own outputs higher
- **Verbosity**: Detailed = better

**Mitigation**: Position swapping, anti-bias prompting

### Pairwise Comparison

```python
score_ab = judge.compare(output_a, output_b)
score_ba = judge.compare(output_b, output_a)
consistent = (score_ab > 0.5) != (score_ba > 0.5)
```

### Probe-Based Testing

| Probe | Tests | Example |
|-------|-------|---------|
| Recall | Facts | "What was the error?" |
| Artifact | Files | "Which files modified?" |
| Continuation | Planning | "What's next?" |
| Decision | Reasoning | "Why chose X?" |

## Test Set Design

```python
class TestSet:
    def sample_stratified(self, n):
        per_level = n // 3
        return (
            sample(self.simple, per_level) +
            sample(self.medium, per_level) +
            sample(self.complex, per_level)
        )
```

## Production Monitoring

```python
class Monitor:
    sample_rate = 0.01  # 1% sampling
    alert_threshold = 0.85

    def check(self, scores):
        if avg(scores) < self.alert_threshold:
            self.alert(f"Quality degraded: {avg(scores):.2f}")
```

## Guidelines

1. Start with outcome evaluation, not step-by-step
2. Use multi-dimensional rubrics
3. Mitigate LLM-as-Judge biases
4. Test with stratified complexity
5. Implement continuous monitoring
6. Focus on token efficiency (80% variance)

## Related

- [Context Compression](./context-compression.md)
- [Tool Design](./tool-design.md)
