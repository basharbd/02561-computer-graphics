struct Uniforms {
  eye: vec3f,
  L_e: f32,
  L_a: f32,
  k_d: f32,
  k_s: f32,
  s: f32,
  mvp: mat4x4f,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) inPos: vec4f,
  @location(1) color: vec4f,
  @location(2) normal: vec4f,
}

@vertex
fn main_vs(
  @location(0) inPos: vec4f,
  @location(1) color: vec4f,
  @location(2) normal: vec4f
) -> VSOut {
  var out: VSOut;
  out.position = uniforms.mvp * inPos;
  out.inPos = inPos;
  out.color = color;
  out.normal = normal;
  return out;
}

@fragment
fn main_fs(
  @location(0) inPos: vec4f,
  @location(1) color: vec4f,
  @location(2) normal: vec4f
) -> @location(0) vec4f {

  let n = normalize(normal.xyz);

  // ✅ use OBJ color (rgb) as diffuse base
  let base = color.xyz;

  let k_d = base * uniforms.k_d;
  let k_a = k_d;
  let k_s = vec3f(1.0, 1.0, 1.0) * uniforms.k_s;

  // directional light (fixed)
  let omega_i = normalize(vec3f(0.0, 0.0, 1.0));

  let L_e = vec3f(1.0, 1.0, 1.0) * uniforms.L_e;
  let L_a = vec3f(1.0, 1.0, 1.0) * uniforms.L_a;

  let w_o = normalize(uniforms.eye - inPos.xyz);
  let w_r = 2.0 * dot(omega_i, n) * n - omega_i;

  let diffuseTerm = max(dot(n, omega_i), 0.0);
  let L_rd = k_d * L_e * diffuseTerm;
  let L_ra = k_a * L_a;

  let specTerm = pow(max(dot(w_r, w_o), 0.0), uniforms.s);
  let L_rs = k_s * L_e * specTerm;

  // avoid spec on back side
  let L_rs_ok = select(vec3f(0.0), L_rs, diffuseTerm > 0.0);

  let L_o = L_ra + L_rd + L_rs_ok;
  return vec4f(L_o, 1.0);
}
