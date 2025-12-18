// Uniforms: MVP matrix to transform from model/world to clip space
struct Uniforms {
  mvp : mat4x4f,
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
  @location(0) inPos : vec3f,    // input position (model space)
  @location(1) inColor : vec4f   // per-vertex RGBA color
) -> VSOut {
  var out : VSOut;
  out.position = U.mvp * vec4f(inPos, 1.0); // transform to clip space
  out.color = inColor;                      // pass color through
  return out;
}

@fragment
fn main_fs(@location(0) c : vec4f) -> @location(0) vec4f {
  // Output interpolated color
  return c;
}
