import { useState } from 'react';
import { X, Plus, Trash2, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';

interface CreatePollDialogProps {
  onClose: () => void;
  onPollCreated: (pollData: {
    question: string;
    options: string[];
    duration: number;
  }) => void;
}

export function CreatePollDialog({ onClose, onPollCreated }: CreatePollDialogProps) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState(1440); // 24 hours in minutes

  const addOption = () => {
    if (options.length < 4) {
      setOptions([...options, '']);
    }
  };

  const removeOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const handleSubmit = () => {
    if (!question.trim()) {
      toast.error('Please enter a question');
      return;
    }

    const validOptions = options.filter(opt => opt.trim());
    if (validOptions.length < 2) {
      toast.error('Please provide at least 2 options');
      return;
    }

    onPollCreated({
      question: question.trim(),
      options: validOptions,
      duration
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 border-b border-border flex items-center justify-between sticky top-0 bg-background z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-full">
              <BarChart3 className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-bold">Create Poll</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-semibold mb-3">Your Question</label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question..."
              className="w-full px-4 py-3 border-2 border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-lg transition-all"
              maxLength={120}
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-2 text-right">
              {question.length}/120
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-3">Poll Options</label>
            <div className="space-y-3">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => updateOption(index, e.target.value)}
                      placeholder={`Option ${index + 1}`}
                      className="w-full px-4 py-3 border-2 border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background transition-all"
                      maxLength={50}
                    />
                    {option.length > 0 && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        {option.length}/50
                      </span>
                    )}
                  </div>
                  {options.length > 2 && (
                    <button
                      onClick={() => removeOption(index)}
                      className="p-2.5 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-xl text-red-600 transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 4 && (
              <button
                onClick={addOption}
                className="mt-3 flex items-center gap-2 text-primary hover:text-primary/80 font-medium transition-colors"
              >
                <div className="p-1 bg-primary/10 rounded-lg">
                  <Plus className="w-4 h-4" />
                </div>
                Add another option
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-3">Poll Duration</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 60, label: '1 hour' },
                { value: 360, label: '6 hours' },
                { value: 720, label: '12 hours' },
                { value: 1440, label: '1 day' },
                { value: 4320, label: '3 days' },
                { value: 10080, label: '7 days' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setDuration(option.value)}
                  className={`px-4 py-3 rounded-xl font-medium transition-all ${
                    duration === option.value
                      ? 'bg-primary text-primary-foreground shadow-lg'
                      : 'bg-muted hover:bg-muted/80'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!question.trim() || options.filter(o => o.trim()).length < 2}
            className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-bold text-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            Create Poll
          </button>
        </div>
      </div>
    </div>
  );
}
