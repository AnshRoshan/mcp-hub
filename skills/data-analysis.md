---
name: data-analysis
description: Rigorous data analysis — understand the data and its caveats first, clean deliberately, analyze with the right method, and report numbers you can defend.
category: Data
version: 1.0.0
---

# Data Analysis

Use this skill whenever asked to analyze data: a dataset, query results, metrics, or a report.

## Before analyzing

- **Understand provenance.** Where did the data come from, who collected it, over what period, and what does it NOT include? State the caveats before any conclusion.
- **Profile the shape.** Row counts, missing values, types, ranges, outliers, duplicates. A surprising distribution changes the analysis.
- **Check units and definitions.** "Revenue" can mean many things; confirm what a column actually measures.

## Cleaning

- **Clean deliberately and document every transformation.** Every filter, dedupe rule, and imputation must be stated in the report — reproducible beats clever.
- **Treat missing data as information.** A missing value often means something (not applicable, not recorded, failed pipeline); don't silently drop it.
- **Watch for the classics:** timezone shifts, encoding issues, off-by-one date ranges, duplicate rows that look unique, leaked test data.

## Analysis

- **Answer the question asked, then note what the data actually supports.** Correlation is not causation; small samples do not support big claims.
- **Compare like with like** — same period, same cohort, same units. A 10% "growth" that is an artifact of a longer month is not growth.
- **Quantify uncertainty.** Give ranges, confidence intervals, or at least the sample size behind every headline number.

## Output

Structure: the question, the data and its caveats, the method, the findings (headline first), and the numbers behind each finding — so the report survives a skeptic.
