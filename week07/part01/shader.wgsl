struct Uniforms {
  mvp: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var cubeMap: texture_cube<f32>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) n_world: vec3<f32>,
};

@vertex
fn main_vs(@location(0) inPos: vec3<f32>) -> VSOut {
  var out: VSOut;

  // transform to clip space
  out.position = uniforms.mvp * vec4<f32>(inPos, 1.0);

  // unit sphere: direction from origin acts like a normal
  out.n_world = inPos;

  return out;
}

@fragment
fn main_fs(@location(0) n_world: vec3<f32>) -> @location(0) vec4<f32> {
  // sample cubemap using normalized direction
  let dir = normalize(n_world);
  return textureSample(cubeMap, mySampler, dir);
}
