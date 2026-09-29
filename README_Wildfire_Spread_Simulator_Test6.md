# Wildfire Spread Simulator

**Research concept, model architecture, workflow design, and tool development:** **Zainab Khan**  
**Platform:** Browser-only JavaScript / GitHub Pages  
**Current development branch:** Test6 experimental workflow  
**Primary methods:** Cellular Automata (CA), remote sensing, NASA FIRMS, Google Earth Engine, Open-Meteo, field-assisted weather calibration, multi-run parameter optimization, and independent validation.

> **Research-use notice:** This tool is a research and model-development environment. It is not an operational emergency-warning system and should not be used as the sole basis for evacuation, suppression, or public-safety decisions.

---

## 1. Purpose

The Wildfire Spread Simulator is a browser-based research tool designed to simulate the spatial evolution of wildfire over a user-defined Area of Interest (AOI).

The tool combines:

- a **cellular automaton fire-spread model**;
- remotely sensed environmental information;
- historical or near-real-time fire detections;
- meteorological forcing;
- satellite-derived burned-area reference rasters;
- optional field weather observations;
- optional vegetation and dry-foliage observations;
- automatic parameter/weight optimization;
- calibration and independent validation;
- map, chart, raster, video, and score exports.

The simulator supports three broad workflows:

1. **Nowcast** — simulate an ongoing/recent fire using current or near-current forcing.
2. **Forecast** — propagate fire forward using forecast meteorology.
3. **Hindcast** — reconstruct a historical event and compare it with satellite-observed fire effects.

The scientific objective is not merely to draw an expanding fire polygon. The model attempts to represent how local terrain, atmospheric conditions, surface state, ignition geometry, and stochastic spread interact through time.

---

# 2. Core workflow

The principal modeling workflow is:

**Environmental inputs**  
→ **Optional field-data correction**  
→ **Base simulation**  
→ **Observed vs simulated comparison**  
→ **Optimization search**  
→ **Best parameter/weight combination**  
→ **Optimized calibrated simulation**  
→ **Base vs optimized comparison**  
→ **Independent validation**  
→ **Accept / reject optimized configuration**

The tool deliberately separates:

- **environmental-data calibration** from field observations; and
- **fire-model calibration** through parameter/weight optimization.

These are not the same operation.

---

# 3. Browser architecture

The simulator runs in the browser.

Typical components are:

- **Leaflet** — interactive mapping;
- **JavaScript** — simulation engine, UI, metrics, optimization, export;
- **Web Worker** — long-running optimization without freezing the map/UI;
- **Google Earth Engine** — satellite/environmental data;
- **NASA FIRMS** — active-fire detections;
- **Open-Meteo** — weather forcing;
- **Chart.js** — plots and diagnostics;
- **IndexedDB/local browser storage** — caching and saved settings where enabled.

No dedicated server is required for the basic simulator.

---

# 4. One-time settings

The One-Time Settings section stores credentials/configuration needed by external services.

Typical entries include:

- NASA FIRMS map key;
- Google OAuth Web Client ID;
- Earth Engine Cloud Project ID;
- optional CARTO / OSM-CARTO credential, if required by the selected CARTO service.

A single **Save Settings** control saves the one-time configuration in the browser.

## Basemaps

The map layer control can expose:

1. **Satellite**
2. **OpenStreetMap**
3. **CARTO Dark / dark OSM-style basemap**

CARTO is optional. If it is unavailable, the standard OpenStreetMap and existing satellite layer remain usable.

---

# 5. Area of Interest and computational grid

The user draws or loads an AOI.

The AOI is converted to a square raster grid of cell size \(d\) metres.

For approximate geographic conversion:

$$
\Delta y = \frac{d}{111320}
$$

$$
\Delta x = \frac{d}{111320\cos\phi}
$$

where:

- \(\phi\) = mean AOI latitude;
- \(\Delta x,\Delta y\) are longitude/latitude increments in degrees.

For a raster of \(n_x\) columns and \(n_y\) rows:

$$
N = n_x n_y
$$

is the total grid-cell count before masking.

The model should prevent AOIs that create an impractically large browser grid.

---

# 6. Cellular Automaton representation

Each valid grid cell has a discrete state:

$$
S_i(t)\in \{0,1,2,3\}
$$

where, conceptually:

- \(0\) = unburned/burnable;
- \(1\) = actively burning;
- \(2\) = burned;
- \(3\) = blocked/non-burnable/outside usable domain.

The fire normally propagates through an **8-neighbour Moore neighbourhood**.

For an orthogonal neighbour:

$$
d_{ij}=d
$$

For a diagonal neighbour:

$$
d_{ij}=d\sqrt{2}
$$

where \(d\) is the cell size.

---

# 7. Ignition

Ignition can be initialized from selected FIRMS detections, a user-defined ignition geometry, or the current implementation's supported ignition mode.

For an ignition radius \(r_{\mathrm{ign}}\), all burnable cells whose centres fall within the ignition footprint may be initialized as burning.

The initial condition is therefore:

$$
S_i(0)=1
$$

for selected ignition cells, while other burnable cells begin as:

$$
S_i(0)=0
$$

Water or other blocked cells are prevented from igniting.

---

# 8. Simulation duration and time step

Let:

- \(T\) = total simulation duration;
- \(\Delta t\) = simulation time step.

The number of update steps is approximately:

$$
n_t=\left\lceil\frac{T}{\Delta t}\right\rceil
$$

A smaller \(\Delta t\) provides more frequent CA updates but increases computational cost.

The time step should not be interpreted as the physical lifetime of a fire. It is the numerical update interval.

---

# 9. Burning duration

A burning cell remains active for a minimum burning duration \(t_b\).

The number of required burning steps is:

$$
n_b=\left\lceil\frac{t_b}{\Delta t}\right\rceil
$$

The current CA design also allows an active front to remain burning longer when unburned neighbours remain available, preventing unrealistically slow fronts from extinguishing simply because the per-step spread distance is less than one raster cell.

---

# 10. Environmental conditioning variables

The finalized Test6 design uses the following primary environmental conditioning information:

- NDMI;
- slope;
- wind speed;
- wind direction;
- air temperature;
- relative humidity;
- rainfall/precipitation;
- land-surface temperature (LST);
- water mask as a non-burnable/barrier layer.

**Elevation is not treated as an independent fire-conditioning variable.**  
A DEM may still be used internally to derive slope.

Optional field-derived vegetation/species and dry-foliage layers can be added when supplied.

---

# 11. Remote sensing background

## 11.1 NDMI

The Normalized Difference Moisture Index is:

$$
NDMI=\frac{NIR-SWIR_1}{NIR+SWIR_1}
$$

Higher NDMI generally indicates wetter vegetation/canopy conditions, while lower values indicate relatively drier surface/vegetation conditions.

A normalized moisture state may be represented as:

$$
m=\operatorname{clamp}\left(\frac{NDMI+0.2}{0.6},0,1\right)
$$

where `clamp(x,0,1)` restricts the value to the interval \([0,1]\).

An optimized moisture-response term can then reduce spread potential as moisture rises.

## 11.2 Slope

Slope is derived from the DEM gradient.

If \(z(x,y)\) is elevation:

$$
g_x=\frac{\partial z}{\partial x}, \qquad
g_y=\frac{\partial z}{\partial y}
$$

and:

$$
|\nabla z|=\sqrt{g_x^2+g_y^2}
$$

then slope angle is:

$$
\beta=\tan^{-1}(|\nabla z|)
$$

or in degrees:

$$
\beta_{\deg}=\frac{180}{\pi}\tan^{-1}(|\nabla z|)
$$

The CA engine uses the local slope **in the direction from a burning cell to a candidate neighbour**, because uphill and downhill propagation are not equivalent.

## 11.3 Water mask

A binary water mask is used as a spread barrier:

$$
W_i=
\begin{cases}
1, & \text{water/non-burnable}\\
0, & \text{otherwise}
\end{cases}
$$

For water cells:

$$
P_{\mathrm{ignite},i}=0
$$

The mask may be derived from land-cover water classes and/or a spectral water indicator such as NDWI.

## 11.4 NDWI

Where used for water detection:

$$
NDWI=\frac{Green-NIR}{Green+NIR}
$$

A threshold can be combined with mapped water classes to improve the water barrier.

## 11.5 Land Surface Temperature

LST is treated as a surface thermal conditioning variable.

If Landsat Collection 2 Level-2 surface-temperature DN values are used, the common scaling form is:

$$
T_K = DN \times 0.00341802 + 149.0
$$

$$
LST_{^\circ C}=T_K-273.15
$$

The exact source/scaling must always follow the active satellite product used by the implementation.

LST should not be confused with 2-m air temperature. They represent different physical quantities.

---

# 12. Satellite burn reference

The hindcast/calibration workflow uses a satellite-derived burned-area reference.

## 12.1 Normalized Burn Ratio

$$
NBR=\frac{NIR-SWIR_2}{NIR+SWIR_2}
$$

## 12.2 Differenced NBR

$$
dNBR=NBR_{\mathrm{pre}}-NBR_{\mathrm{post}}
$$

A binary observed burned raster can be defined as:

$$
B_i=
\begin{cases}
1,& dNBR_i>\tau\\
0,& \text{otherwise}
\end{cases}
$$

where \(\tau\) is the selected burn threshold.

## 12.3 Relativized Burn Ratio

Where RBR is selected:

$$
RBR=\frac{dNBR}{NBR_{\mathrm{pre}}+1.001}
$$

and the same thresholding concept is applied to generate a reference burned/non-burned map.

The reference is used for model evaluation; it is not automatically assumed to be perfect ground truth.

---

# 13. Weather forcing

Weather is sampled over a spatial lattice and interpolated to CA cells.

Typical variables are:

- air temperature \(T\);
- relative humidity \(RH\);
- precipitation \(P\);
- wind speed \(V\);
- wind direction \(\theta_w\).

## 13.1 Bilinear spatial interpolation

For a cell inside four surrounding weather nodes:

$$
X(x,y)=
w_{00}X_{00}+
w_{10}X_{10}+
w_{01}X_{01}+
w_{11}X_{11}
$$

with weights determined from fractional position \(f_x,f_y\):

$$
w_{00}=(1-f_x)(1-f_y)
$$

$$
w_{10}=f_x(1-f_y)
$$

$$
w_{01}=(1-f_x)f_y
$$

$$
w_{11}=f_xf_y
$$

and:

$$
\sum w=1
$$

## 13.2 Temporal interpolation

Between two hourly values \(X_0\) and \(X_1\):

$$
X(t)=(1-f)X_0+fX_1
$$

where \(f\in[0,1]\) is the fraction of the hour elapsed.

---

# 14. Wind vectors

Wind direction is circular data and should not be interpolated as an ordinary scalar angle.

For wind speed \(V\) and direction \(\theta\):

$$
u=V\sin\theta
$$

$$
v=V\cos\theta
$$

The \(u\) and \(v\) components are interpolated separately.

Then:

$$
V=\sqrt{u^2+v^2}
$$

$$
\theta=\operatorname{atan2}(u,v)
$$

with the angle converted to \(0^\circ\)–\(360^\circ\).

---

# 15. Atmospheric response functions used by the CA engine

The current CA family uses smooth response functions so wet/humid conditions slow fire without forcing the probability to collapse abruptly to zero.

## 15.1 Relative humidity factor

$$
f_{RH}=
\max\left(0.15,\,
1-0.75\left(\frac{RH}{100}\right)^2
\right)
$$

Higher relative humidity reduces spread potential.

## 15.2 Air-temperature factor

$$
f_T=
\operatorname{clamp}
\left[
\exp\left(0.03(T-25)\right),
0.6,
1.6
\right]
$$

This represents a bounded thermal influence on spread.

## 15.3 Antecedent precipitation index

Recent rainfall is accumulated with exponentially decaying memory:

$$
API(t)=
\sum_{h=0}^{72}
P(t-h)\exp\left(-\frac{h}{48}\right)
$$

Recent rainfall therefore contributes more strongly than older rainfall.

## 15.4 Rain factor

$$
f_{\mathrm{rain}}=
0.3+0.7\exp(-k_r API)
$$

where \(k_r\) is a rain-response parameter that can be calibrated/optimized.

---

# 16. Wind effect on fire propagation

For a candidate spread direction and local wind speed \(V\), the wind multiplier is:

$$
f_{\mathrm{wind}}
=
\exp(c_1V)
\exp\left[c_2V(\cos\theta-1)\right]
$$

where:

- \(V\) = wind speed;
- \(\theta\) = angular difference between wind direction and the candidate fire-propagation direction;
- \(c_1=0.045\);
- \(c_2=0.131\) in the current CA formulation.

Thus:

- downwind spread receives the greatest enhancement;
- crosswind spread receives less enhancement;
- upwind spread is penalized.

---

# 17. Slope effect on spread

The directional slope multiplier is:

$$
f_{\mathrm{slope}}=
\exp(0.078\,\beta)
$$

where \(\beta\) is the directional slope angle in degrees, bounded in the current engine to approximately:

$$
-45^\circ \le \beta \le 45^\circ
$$

Positive/uphill slopes increase the multiplier; downhill slopes reduce it.

---

# 18. Combined spread rate

Let:

- \(R_0\) = base spread rate;
- \(C_j\) = local conditioning term for the candidate cell;
- \(f_{RH}\) = humidity factor;
- \(f_T\) = air-temperature factor;
- \(f_{\mathrm{rain}}\) = antecedent-rain factor;
- \(f_{\mathrm{wind}}\) = wind multiplier;
- \(f_{\mathrm{slope}}\) = slope multiplier.

A generic multiplicative form is:

$$
R_{ij}
=
R_0\,
C_j\,
f_{RH}\,
f_T\,
f_{\mathrm{rain}}\,
f_{\mathrm{wind}}\,
f_{\mathrm{slope}}
$$

The current CA engine also protects against numerical collapse with a small minimum spread rate:

$$
R_{ij}=\max(R_{\min},R_{ij})
$$

The final Test6 conditioning term \(C_j\) is constructed from the conditioning variables and their active/optimized weights in the source implementation.

A general weighted representation is:

$$
C_j=
\prod_{k=1}^{K}
f_k(j,t)^{w_k}
$$

or equivalently:

$$
\ln C_j=
\sum_{k=1}^{K}w_k\ln f_k(j,t)
$$

where:

- \(f_k\) is the normalized response of conditioning variable \(k\);
- \(w_k\) is its model weight.

The source code remains the final authority for the exact active response functions and optimized coefficients in each release.

---

# 19. Stochastic ignition probability

A spread rate is converted to a probability that fire crosses the distance to a neighbour within the current time step:

$$
p_{ij}
=
1-
\exp\left(
-\frac{R_{ij}\Delta t}{d_{ij}}
\right)
$$

A uniform random number \(U\sim U(0,1)\) is generated.

The candidate cell ignites when:

$$
U<p_{ij}
$$

This produces a probabilistic CA rather than a deterministic ring expansion.

For small \(R\Delta t/d\):

$$
p\approx \frac{R\Delta t}{d}
$$

which helps maintain approximate consistency across sufficiently small time steps.

---

# 20. Optional Field Data

The **Optional Field Data** section sits below the environmental-data section and contains:

1. **Weather Calibration**
2. **Vegetation & Fuel Observation**

If no field data are supplied, the model follows the normal existing workflow with no field-derived effect.

---

# 21. Weather field observations

Supported patterns include:

- one location + one time;
- multiple locations + one time;
- one location + multiple times.

Observations may be entered manually or through CSV.

Only variables actually supplied are corrected.

Missing variables remain unchanged.

---

# 22. Bias correction

## 22.1 Single matched observation

For a modeled value \(M\) and field observation \(O\):

$$
b=O-M
$$

An additive correction is:

$$
M_{\mathrm{BC}}=M+b
$$

This is especially natural for variables such as temperature or LST.

For strictly non-negative variables, an implementation may instead use a multiplicative ratio where physically appropriate:

$$
r=\frac{O}{M}
$$

$$
M_{\mathrm{BC}}=rM
$$

with safeguards against division by zero and physically impossible output.

## 22.2 Multiple observations

For \(n\) matched modeled/observed pairs:

$$
b=
\frac{1}{n}
\sum_{i=1}^{n}(O_i-M_i)
$$

and:

$$
M_{\mathrm{BC}}=M+b
$$

or a variable-appropriate multiplicative form may be used.

The chosen correction method and units must remain explicit.

---

# 23. Circular bias correction for wind direction

Wind direction must not be corrected using an ordinary arithmetic angular difference.

For paired observed/model directions:

$$
\Delta\theta_i=
\theta_{O,i}-\theta_{M,i}
$$

The mean circular angular bias is:

$$
\delta=
\operatorname{atan2}
\left(
\sum_i\sin\Delta\theta_i,\,
\sum_i\cos\Delta\theta_i
\right)
$$

The corrected direction is:

$$
\theta_{\mathrm{BC}}
=
(\theta_M+\delta)\bmod 360^\circ
$$

---

# 24. Quantile Mapping

Quantile Mapping (QM) requires multiple matched observations.

For model CDF \(F_M\) and observed CDF \(F_O\):

$$
x_{\mathrm{QM}}
=
F_O^{-1}
\left[
F_M(x_M)
\right]
$$

Interpretation:

1. determine where the modeled value lies in the modeled distribution;
2. find the observed value at the same cumulative probability;
3. replace/correct the modeled value with that observed-distribution counterpart.

For one single observation:

$$
n=1
$$

there is no empirical distribution to map, so Quantile Mapping is disabled and Bias Correction is used.

QM can be used when multiple observations exist:

- across **space** at one time; or
- across **time** at one location.

Small sample sizes should be interpreted cautiously because empirical quantiles are poorly constrained when \(n\) is very small.

---

# 25. Example weather CSV

```csv
date,time,latitude,longitude,air_temp_c,relative_humidity_pct,rain_mm,wind_speed_m_s,wind_direction_deg,lst_c
2026-05-18,14:30,30.1234,78.4567,31.2,34,0,4.8,245,42.6
2026-05-18,14:30,30.1261,78.4612,30.7,36,,5.1,252,41.9
2026-05-18,14:30,30.1300,78.4700,,,0,4.4,250,40.8
```

Blank optional cells are valid.

The importer should report:

- rows loaded;
- valid rows;
- rejected rows;
- variables found;
- matched observations;
- variables corrected;
- selected correction method.

---

# 26. Vegetation and fuel field observation

The field observer may provide:

- one or more dominant plant/tree/crop species;
- presence/absence of dry foliage or litter;
- observer-assigned dry-foliage flammability: Low / Medium / High.

Species information is optional.

---

# 27. Species flammability classification

For each named species, the tool attempts a traceable literature/online lookup.

A species is classified as:

$$
s_i\in\{1,2,3\}
$$

where:

- \(1\) = Low;
- \(2\) = Medium;
- \(3\) = High.

If a species cannot be resolved reliably, it is marked **unresolved** and excluded rather than guessed.

For \(n\) valid species:

$$
\bar{s}
=
\frac{1}{n}
\sum_{i=1}^{n}s_i
$$

A representative class may be assigned from the rounded mean:

$$
S=\operatorname{round}(\bar{s})
$$

and mapped back to Low / Medium / High.

This representative class is then expanded across the AOI as a uniform species-observation raster, where the user has explicitly chosen the observation to represent the AOI.

---

# 28. Dry-foliage layer

If dry foliage/litter is absent, no foliage layer is applied.

If present, the observer supplies:

$$
L\in\{1,2,3\}
$$

for Low / Medium / High flammability.

The foliage raster is:

$$
F_i=L
$$

for applicable AOI cells.

If the observation is missing, the foliage term is omitted and has no effect on the model.

---

# 29. Base run

The **Base Run** uses the current/user-selected simulator parameters and conditioning weights before optimization.

It produces:

- fire state through time;
- final burned/burning raster;
- growth graph;
- meteorological plots;
- optional video;
- validation statistics where a reference is available.

The Base configuration is always retained so optimization can be rejected safely.

---

# 30. Observed vs simulated comparison

Let:

- \(P_i\in\{0,1\}\) = predicted burned state;
- \(O_i\in\{0,1\}\) = observed reference state.

Then:

$$
TP=\sum_i I(P_i=1,O_i=1)
$$

$$
FP=\sum_i I(P_i=1,O_i=0)
$$

$$
FN=\sum_i I(P_i=0,O_i=1)
$$

$$
TN=\sum_i I(P_i=0,O_i=0)
$$

All classification metrics are derived from these four quantities.

---

# 31. Precision

$$
Precision=\frac{TP}{TP+FP}
$$

Meaning:

> Of all cells the model called fire/burned, how many were actually fire/burned?

Low precision implies many false alarms.

---

# 32. Recall / Sensitivity

$$
Recall=Sensitivity=\frac{TP}{TP+FN}
$$

Meaning:

> Of all truly burned cells, how many did the model capture?

Low recall means many real burned cells were missed.

---

# 33. Specificity

$$
Specificity=\frac{TN}{TN+FP}
$$

Meaning:

> Of all truly non-burned cells, how many did the model correctly identify as non-burned?

---

# 34. Accuracy

$$
Accuracy=\frac{TP+TN}{TP+TN+FP+FN}
$$

Accuracy is reported but **must not be used alone** for wildfire-model optimization because non-burned pixels can dominate the raster.

---

# 35. F1 score

$$
F1=2\frac{Precision\cdot Recall}{Precision+Recall}
$$

Equivalent form:

$$
F1=\frac{2TP}{2TP+FP+FN}
$$

F1 balances false alarms and missed fire.

---

# 36. Intersection over Union

$$
IoU=\frac{TP}{TP+FP+FN}
$$

IoU is especially useful for spatial fire footprints because it measures overlap between observed and simulated burned areas.

---

# 37. Commission and omission errors

$$
Commission=1-Precision
$$

$$
Omission=1-Recall
$$

Commission corresponds to excess predicted fire.

Omission corresponds to missed observed fire.

---

# 38. Cohen's Kappa

Observed agreement:

$$
p_o=\frac{TP+TN}{N}
$$

Expected chance agreement:

$$
p_e=
\frac{(TP+FP)(TP+FN)+(FN+TN)(FP+TN)}{N^2}
$$

Then:

$$
\kappa=\frac{p_o-p_e}{1-p_e}
$$

Kappa measures agreement beyond expected chance agreement.

---

# 39. Matthews Correlation Coefficient

$$
MCC=
\frac{TP\cdot TN-FP\cdot FN}
{\sqrt{(TP+FP)(TP+FN)(TN+FP)(TN+FN)}}
$$

MCC ranges approximately from:

$$
-1\le MCC\le1
$$

where:

- \(1\) = perfect classification;
- \(0\) = no useful correlation;
- \(-1\) = complete inverse classification.

It is valuable when class sizes are unequal.

---

# 40. Area error

For cell area \(A_c\):

$$
A_{\mathrm{pred}}=N_{\mathrm{pred}}A_c
$$

$$
A_{\mathrm{obs}}=N_{\mathrm{obs}}A_c
$$

Area bias:

$$
Bias_A=A_{\mathrm{pred}}-A_{\mathrm{obs}}
$$

Relative area error:

$$
RE_A=100\frac{A_{\mathrm{pred}}-A_{\mathrm{obs}}}{A_{\mathrm{obs}}}
$$

---

# 41. ROC and AUC

For a continuous burn probability/score, threshold \(\tau\) is varied.

True-positive rate:

$$
TPR(\tau)=Recall(\tau)
$$

False-positive rate:

$$
FPR(\tau)=1-Specificity(\tau)
$$

The ROC curve plots:

$$
TPR \text{ vs } FPR
$$

AUC is the area under this curve.

AUC near \(0.5\) indicates little discrimination; larger values indicate greater separation between burned and non-burned cells.

---

# 42. Precision-Recall curve and Average Precision

For changing probability thresholds, the PR curve plots:

$$
Precision(\tau)
$$

against:

$$
Recall(\tau)
$$

Average Precision / PR-AUC summarizes this relationship.

PR analysis is often informative when the positive class (burned area) occupies a smaller fraction of the AOI.

---

# 43. Optimization and calibration

The optimization engine searches combinations of:

- existing simulator parameters;
- existing conditioning-variable weights;
- optional field-derived layer weights when active.

It does not simply change a few displayed values once.

Each candidate must produce a **real CA simulation**.

---

# 44. Runtime benchmark

Before optimization, the system quietly executes approximately 2–3 representative trial simulations.

If their runtimes are:

$$
t_1,t_2,t_3
$$

the representative single-run time is:

$$
t_{\mathrm{run}}=\operatorname{median}(t_1,t_2,t_3)
$$

For \(N_r\) planned candidate runs:

$$
T_{\mathrm{est}}\approx N_r\,t_{\mathrm{run}}
$$

The estimate can be updated during execution using the observed mean/median runtime.

---

# 45. Optimization depth

The UI supports:

- **Quick**
- **Standard**
- **Deep**
- **Custom**

These represent different search budgets.

The actual number of runs is adapted to:

- AOI size;
- number of grid cells;
- simulation duration;
- time step;
- device/browser speed;
- benchmark runtime.

Custom mode allows an explicit run count within a safe browser limit.

---

# 46. Coarse-to-fine search

A full Cartesian search is avoided.

If \(K\) parameters each had \(m\) candidate values, exhaustive search would require:

$$
N_{\mathrm{grid}}=m^K
$$

For example:

$$
5^{10}=9,765,625
$$

runs, which is impractical in a browser.

Instead:

1. sample the parameter space broadly;
2. evaluate real CA runs;
3. retain the best candidates;
4. narrow the search region;
5. sample/refine around promising candidates;
6. retain the best configuration.

---

# 47. Optimization objective

No single metric should define "best" for every use case.

A general multi-metric objective can be written as:

$$
J(\mathbf{q})=
\sum_{m=1}^{M}\lambda_m\,\widetilde{S}_m(\mathbf{q})
$$

where:

- \(\mathbf{q}\) = candidate parameter/weight vector;
- \(\widetilde{S}_m\) = normalized validation metric;
- \(\lambda_m\ge0\);
- \(\sum_m\lambda_m=1\).

Possible terms include:

- IoU;
- F1;
- Recall/Sensitivity;
- Precision;
- MCC;
- constraints on Specificity or false-alarm rate.

Different optimization priorities can change the \(\lambda_m\) values.

For MCC, which ranges from \(-1\) to \(1\), a 0–1 transformation can be used when needed:

$$
MCC^*=\frac{MCC+1}{2}
$$

Accuracy should not dominate \(J\).

---

# 48. Why a holdout event is required

Optimization can overfit the event used to select parameters.

Therefore events are separated into:

- **training/calibration events** used during search;
- **held-out validation events** not shown to the optimizer.

Let the best optimized parameters be:

$$
\mathbf{q}^*=\arg\max_{\mathbf{q}}J_{\mathrm{train}}(\mathbf{q})
$$

After search, evaluate:

$$
J_{\mathrm{holdout}}(\mathbf{q}^*)
$$

and compare it with the Base model:

$$
J_{\mathrm{holdout}}(\mathbf{q}_{base})
$$

The optimized model should not be accepted simply because:

$$
J_{\mathrm{train}}(\mathbf{q}^*)>J_{\mathrm{train}}(\mathbf{q}_{base})
$$

It must also generalize satisfactorily to the held-out data.

---

# 49. Accept / reject logic

Conceptually:

$$
Accept=
\begin{cases}
1,& J_{\mathrm{holdout}}(\mathbf{q}^*)>J_{\mathrm{holdout}}(\mathbf{q}_{base})\text{ and safeguards pass}\\
0,& \text{otherwise}
\end{cases}
$$

If rejected, the Base configuration remains available and unchanged.

This prevents a calibration that looks better during fitting but performs worse independently from replacing the more reliable Base model.

---

# 50. Memory management during optimization

The complete raster from every candidate run should not be retained.

For normal candidate \(r\), store only the parameter vector and the required metrics, for example:

```text
run number
parameter / weight combination
TP, FP, FN, TN
Precision
Recall / Sensitivity
Specificity
F1
IoU
MCC
objective score
```

Full raster outputs are retained only where needed, such as:

- Base run;
- current/final best candidate;
- final optimized-calibrated run.

This keeps large-AOI optimization practical in a browser.

---

# 51. Recommended user procedure

## Step 1 — Configure accounts

Enter the required one-time settings and save them.

Use the optional CARTO credential only if available.

## Step 2 — Select basemap

Choose Satellite, OpenStreetMap, or CARTO Dark as required.

## Step 3 — Define AOI

Draw or load the area to simulate.

Avoid unnecessarily large areas because cell count controls computational cost.

## Step 4 — Select workflow

Choose Nowcast, Forecast, or Hindcast.

## Step 5 — Load/select fire information

Load FIRMS detections or the supported local fire source and select the relevant event/range.

## Step 6 — Configure environmental windows

Set the appropriate satellite/weather date windows.

## Step 7 — Optional field data

If field observations exist:

- expand **Optional Field Data**;
- enter/upload weather data;
- choose Bias Correction or Quantile Mapping when available;
- add dominant species if known;
- add dry-foliage information if observed.

If no field data exist, leave the section untouched.

## Step 8 — Prepare data

Allow the tool to fetch/process remote sensing, weather, fire, and reference information.

## Step 9 — Run Base simulation

Run the model using the current parameters.

## Step 10 — Evaluate Base result

Inspect spatial overlap and the validation statistics.

## Step 11 — Optimize

Choose Quick, Standard, Deep, or Custom.

The tool performs benchmark runs, estimates runtime, and begins genuine multi-run CA optimization.

## Step 12 — Calibrated run

The best candidate is rerun as the optimized calibrated model.

## Step 13 — Independent validation

Compare Base and optimized models on the held-out event.

## Step 14 — Accept or reject

Retain the optimized configuration only if the independent evidence supports it.

## Step 15 — Export

Export available rasters, scores, plots, and videos.

---

# 52. Interpreting the main validation metrics

| Metric | Main question |
|---|---|
| Precision | Of the fire the model predicted, how much was correct? |
| Recall / Sensitivity | Of the fire that really occurred, how much did the model capture? |
| Specificity | Of the true non-fire area, how much did the model correctly keep as non-fire? |
| F1 | How well are Precision and Recall balanced? |
| IoU | How strongly do observed and simulated fire footprints overlap? |
| MCC | How well does the complete binary classification agree, accounting for all four confusion-matrix cells? |
| Accuracy | What fraction of all cells is correct? Useful, but potentially misleading when non-fire dominates. |

---

# 53. Important modeling assumptions

1. Satellite burned-area products are treated as reference observations, not perfect truth.
2. Fire spread is stochastic.
3. Model coefficients require regional/event calibration.
4. Weather interpolation introduces spatial and temporal uncertainty.
5. Field observations improve local information but do not remove all raster uncertainty.
6. A single field point cannot fully describe a heterogeneous AOI.
7. Quantile Mapping requires multiple samples and becomes unstable with very small sample sizes.
8. Species-level flammability depends on literature quality and environmental context.
9. A uniform AOI-wide species or foliage raster is a deliberate generalization when the user states that the field observation is representative.
10. Optimization improves fit only within the parameter space and objective function supplied to it.
11. Independent validation is required to detect overfitting.
12. The model is a research simulator, not an operational fire-behaviour certification system.

---

# 54. Data provenance

Depending on mode and configuration, the tool may use:

- **NASA FIRMS** — active-fire detections;
- **Google Earth Engine** — satellite imagery and environmental layers;
- **Landsat / Sentinel-2** — spectral indices and burned-area reference;
- **Copernicus DEM** — terrain data used to derive slope;
- **Open-Meteo** — historical/forecast meteorology;
- user-supplied field observations;
- user-supplied CSV/GeoJSON where supported.

Every scientific analysis should record:

- AOI;
- run date;
- event date/time;
- satellite source;
- weather source;
- cell size;
- burn threshold;
- simulator parameters;
- conditioning weights;
- field-calibration method;
- optimization depth/run count;
- validation partition;
- final metrics.

---

# 55. Reproducibility

Because the CA is stochastic, reproducible calibration should use a fixed pseudo-random seed during candidate comparison.

For candidate \(q\), all competing parameter combinations should be evaluated using the same random stream for the same event.

This reduces the chance that one parameter set appears superior merely because it received a luckier random sequence.

Final research ensembles may then be run with multiple seeds to quantify stochastic uncertainty.

---

# 56. Suggested stochastic ensemble extension

For \(K\) repeated simulations of the same calibrated model, the burn probability at cell \(i\) can be estimated as:

$$
\hat{p}_i=\frac{1}{K}\sum_{k=1}^{K}I(B_{ik}=1)
$$

This produces a burn-probability raster rather than only one realization.

The ensemble mean burned area is:

$$
\bar{A}=\frac{1}{K}\sum_{k=1}^{K}A_k
$$

and uncertainty can be reported using quantiles across runs.

---

# 57. Scientific references

1. **Alexandridis, A., Vakalis, D., Siettos, C. I., & Bafas, G. V. (2008).** A cellular automata model for forest fire spread prediction: The case of the wildfire that swept through Spetses Island in 1990. *Applied Mathematics and Computation, 204*(1), 191–201. https://doi.org/10.1016/j.amc.2008.06.046

2. **Key, C. H., & Benson, N. C. (2006).** Landscape Assessment (LA). In *FIREMON: Fire Effects Monitoring and Inventory System*. USDA Forest Service General Technical Report RMRS-GTR-164-CD.

3. **Parks, S. A., Dillon, G. K., & Miller, C. (2014).** A New Metric for Quantifying Burn Severity: The Relativized Burn Ratio. *Remote Sensing, 6*(3), 1827–1844. https://doi.org/10.3390/rs6031827

4. **Cannon, A. J., Sobie, S. R., & Murdock, T. Q. (2015).** Bias correction of GCM precipitation by quantile mapping: How well do methods preserve changes in quantiles and extremes? *Journal of Climate, 28*, 6938–6959.

5. NASA FIRMS documentation and active-fire products.

6. Google Earth Engine documentation and the documentation of the satellite datasets used by the active implementation.

7. Open-Meteo historical/forecast API documentation.

---

# 58. Version synchronization note

This README documents the **finalized research design discussed for the Test6 workflow** and the mathematical CA framework used by the current simulator family.

Because Test6 is an experimental development branch, the **source code is the final authority** for the exact coefficient values, active conditioning-variable response functions, parameter bounds, optimization objective weights, and export behaviour.

Whenever the source implementation changes, update the corresponding equation/parameter section of this README so that the documentation and executable model remain synchronized.

---

# 59. Citation / attribution

If this tool is used in a manuscript, report, thesis, or demonstration, report the exact version or commit, AOI/event, environmental sources, model parameters, calibration method, optimization budget, and validation strategy.

**Developer / Research Designer:** Zainab Khan

---

# 60. Short Hindi guide

**Precision:** मॉडल ने जितनी जगह आग बताई, उनमें से कितनी सच निकली।

**Sensitivity / Recall:** वास्तव में जितनी आग थी, उनमें से मॉडल ने कितनी पकड़ ली।

**Specificity:** जहाँ वास्तव में आग नहीं थी, उनमें से मॉडल ने कितनी जगह सही non-fire पहचानी।

**IoU:** वास्तविक और simulated burned area का spatial overlap।

**Field Weather Calibration:** एक observation हो तो Bias Correction; multiple matched observations हों तो Bias Correction या Quantile Mapping।

**Optimization:** अलग-अलग parameter/weight combinations पर वास्तविक CA runs चलाकर best combination खोजा जाता है।

**Validation:** optimization में इस्तेमाल न किए गए holdout event पर Base और Optimized model की तुलना की जाती है।

---

## End
