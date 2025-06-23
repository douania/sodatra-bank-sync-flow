
import React from 'react';
import { Check } from 'lucide-react';

interface Step {
  id: number;
  title: string;
  description: string;
  status: 'pending' | 'current' | 'completed';
}

interface StepperProps {
  steps: Step[];
}

const Stepper: React.FC<StepperProps> = ({ steps }) => {
  return (
    <div className="mb-8">
      <nav aria-label="Progress">
        <ol className="flex items-center">
          {steps.map((step, stepIdx) => (
            <li key={step.id} className={`relative ${stepIdx !== steps.length - 1 ? 'pr-8 sm:pr-20' : ''} flex-1`}>
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${
                    step.status === 'completed'
                      ? 'border-blue-600 bg-blue-600'
                      : step.status === 'current'
                      ? 'border-blue-600 bg-white'
                      : 'border-gray-300 bg-white'
                  }`}>
                    {step.status === 'completed' ? (
                      <Check className="h-5 w-5 text-white" />
                    ) : (
                      <span className={`text-sm font-medium ${
                        step.status === 'current' ? 'text-blue-600' : 'text-gray-500'
                      }`}>
                        {step.id}
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-4 min-w-0 flex-1">
                  <p className={`text-sm font-medium ${
                    step.status === 'current' ? 'text-blue-600' : 'text-gray-900'
                  }`}>
                    {step.title}
                  </p>
                  <p className="text-sm text-gray-500">{step.description}</p>
                </div>
              </div>
              {stepIdx !== steps.length - 1 && (
                <div className="absolute top-5 right-0 hidden h-0.5 w-8 bg-gray-200 sm:block sm:w-20" />
              )}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
};

export default Stepper;
