struct Uniforms {
  mvp: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var myTexture: texture_2d<f32>;

const PI: f32 = 3.141592653589793;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) n_in: vec3<f32>,
};

@vertex
fn main_vs(@location(0) inPos: vec3<f32>) -> VSOut {
  var out: VSOut;

  // clip-space position
  out.position = uniforms.mvp * vec4<f32>(inPos, 1.0);

  // sphere: position direction acts like a normal
  out.n_in = inPos;

  return out;
}

fn uv_from_normal(n: vec3<f32>) -> vec2<f32> {
  // compute longitude -> u
  var u = 0.5 + atan2(n.z, n.x) / (2.0 * PI);
  u = u - floor(u);

  // compute latitude -> v
  let y = clamp(n.y, -1.0, 1.0);
  let v = acos(y) / PI;

  return vec2<f32>(u, v);
}

@fragment
fn main_fs(@location(0) n_in: vec3<f32>) -> @location(0) vec4<f32> {
  // normalize interpolated direction
  let n = normalize(n_in);

  // map normal to UV and sample texture
  let uv = uv_from_normal(n);
  let tex = textureSample(myTexture, mySampler, uv).rgb;

  // simple directional light + ambient
  let omega_i = normalize(vec3<f32>(0.2, 0.3, 1.0));
  let L_e = vec3<f32>(1.0);
  let L_a = vec3<f32>(0.12);

  let ndotl = max(dot(n, omega_i), 0.0);
  let diffuse = tex * L_e * ndotl;
  let ambient = tex * L_a;

  return vec4<f32>(diffuse + ambient, 1.0);
}
