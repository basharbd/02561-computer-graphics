// Uniforms: 3 MVP matrices (one per instance)
struct Uniforms {
  mvp : array<mat4x4f, 3>,
};

@group(0) @binding(0)
var<uniform> U : Uniforms;

// Vertex shader output: clip-space position + interpolated color
struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f,
};

@vertex
fn main_vs(
  @location(0) inPos : vec3f,                    // model-space position
  @location(1) inColor : vec4f,                  // per-vertex RGBA color
  @builtin(instance_index) instance : u32        // which instance we are drawing (0..2)
) -> VSOut {
  var out : VSOut;

  // Pick the MVP for this instance and transform to clip space
  out.position = U.mvp[instance] * vec4f(inPos, 1.0);

  // Pass color through (will interpolate along lines)
  out.color = inColor;
  return out;
}

@fragment
fn main_fs(@location(0) c : vec4f) -> @location(0) vec4f {
  // Output interpolated color
  return c;
}
