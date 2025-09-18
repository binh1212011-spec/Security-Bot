Reader reader = new FileReader("warnings.json");
Type type = new TypeToken<Map<String, Integer>>(){}.getType();
warnings = gson.fromJson(reader,type);
reader.close();
